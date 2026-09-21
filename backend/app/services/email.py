"""Outbound email. For now every message lands in the outbox table only; a real SMTP/API
sender can be added behind this function without touching callers."""

from sqlalchemy.orm import Session

from app.models import OutboxEmail


def queue_email(db: Session, to: str, subject: str, body: str) -> OutboxEmail:
    email = OutboxEmail(to_address=to, subject=subject, body=body)
    db.add(email)
    return email
