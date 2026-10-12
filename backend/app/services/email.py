"""Outbound email: queued into the outbox table, delivered later by the worker.

Queueing happens inside the caller's transaction (EML-03), so a change that rolls back never
sends anything. Delivery is a separate step that can fail and be retried without touching
business data - and with no SMTP host configured (dev, tests, CI) nothing is sent at all and
the rows simply stay readable through /test/emails.
"""

import logging
import smtplib
from collections.abc import Callable
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core import clock
from app.models import OutboxEmail

logger = logging.getLogger("homebasics.email")

MAX_ATTEMPTS = 5  # then the row is left alone for a human to look at


def queue_email(db: Session, to: str, subject: str, body: str) -> OutboxEmail:
    email = OutboxEmail(to_address=to, subject=subject, body=body)
    db.add(email)
    return email


Transport = Callable[[Settings, OutboxEmail], None]


def smtp_transport(settings: Settings, email: OutboxEmail) -> None:
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = email.to_address
    message["Subject"] = email.subject
    message.set_content(email.body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password or "")
        smtp.send_message(message)


def send_pending(
    db: Session, settings: Settings | None = None, transport: Transport | None = None
) -> int:
    """Deliver a batch of queued emails. Returns how many went out.

    Rows are locked with SKIP LOCKED, so several workers can run without sending anything
    twice. A failure records the attempt and leaves the row for the next tick.
    """
    settings = settings or get_settings()
    # Looked up at call time, not bound as a default, so a different transport can be
    # swapped in (tests, or an HTTP email API later).
    transport = transport or smtp_transport
    if not settings.email_sending_enabled:
        return 0

    pending = db.scalars(
        select(OutboxEmail)
        .where(OutboxEmail.sent_at.is_(None), OutboxEmail.attempts < MAX_ATTEMPTS)
        .order_by(OutboxEmail.id)
        .limit(settings.outbox_batch_size)
        .with_for_update(skip_locked=True)
    ).all()

    sent = 0
    for email in pending:
        email.attempts += 1
        try:
            transport(settings, email)
        except Exception as exc:  # noqa: BLE001 - any failure is just a retry
            email.last_error = f"{type(exc).__name__}: {exc}"[:300]
            logger.warning("email %s to %s failed: %s", email.id, email.to_address, exc)
        else:
            email.sent_at = clock.now()
            email.last_error = None
            sent += 1
        db.commit()
    return sent
