"""OPS-01: delivering the outbox and running the expiry sweep without a request.

Nothing here talks to a real mail server: the transport is a stub, which is also what proves
the retry and give-up behaviour.
"""

import pytest
from sqlalchemy import select

from app.core import worker
from app.models import OutboxEmail
from app.services.email import MAX_ATTEMPTS, queue_email, send_pending
from tests.helpers import travel
from tests.integration.checkout_support import add, place


@pytest.fixture
def sending(test_settings):
    """Settings with SMTP configured, so delivery is switched on."""
    return test_settings.model_copy(update={"smtp_host": "smtp.test", "outbox_batch_size": 2})


@pytest.fixture
def queued(db):
    def _queue(n=1):
        rows = [queue_email(db, f"to{i}@e2e.test", f"Subject {i}", "Body") for i in range(n)]
        db.commit()
        return rows

    return _queue


class Transport:
    """Records what it was asked to send; can be told to fail."""

    def __init__(self, fail: bool = False):
        self.sent: list[tuple[str, str]] = []
        self.fail = fail

    def __call__(self, settings, email):
        if self.fail:
            raise ConnectionRefusedError("mail server down")
        self.sent.append((email.to_address, email.subject))


def test_nothing_is_sent_without_an_smtp_host(db, test_settings, queued):
    queued(2)
    transport = Transport()
    assert send_pending(db, test_settings, transport) == 0
    assert transport.sent == []
    assert db.scalar(select(OutboxEmail).limit(1)).sent_at is None  # still queued, not lost


def test_sends_and_marks_each_row(frozen_clock, db, sending, queued):
    queued(2)
    transport = Transport()
    assert send_pending(db, sending, transport) == 2
    assert transport.sent == [("to0@e2e.test", "Subject 0"), ("to1@e2e.test", "Subject 1")]
    for row in db.scalars(select(OutboxEmail)):
        assert row.sent_at is not None
        assert (row.attempts, row.last_error) == (1, None)


def test_already_sent_rows_are_not_sent_again(db, sending, queued):
    queued(1)
    send_pending(db, sending, Transport())
    second = Transport()
    assert send_pending(db, sending, second) == 0
    assert second.sent == []


def test_one_batch_at_a_time(db, sending, queued):
    queued(5)  # batch size is 2
    assert send_pending(db, sending, Transport()) == 2
    assert send_pending(db, sending, Transport()) == 2
    assert send_pending(db, sending, Transport()) == 1


def test_a_failure_is_recorded_and_retried(db, sending, queued):
    queued(1)
    assert send_pending(db, sending, Transport(fail=True)) == 0
    row = db.scalar(select(OutboxEmail))
    assert (row.sent_at, row.attempts) == (None, 1)
    assert "ConnectionRefusedError" in row.last_error

    assert send_pending(db, sending, Transport()) == 1  # next tick succeeds
    db.refresh(row)
    assert (row.sent_at is not None, row.attempts, row.last_error) == (True, 2, None)


def test_it_gives_up_after_five_attempts(db, sending, queued):
    queued(1)
    for _ in range(MAX_ATTEMPTS):
        send_pending(db, sending, Transport(fail=True))
    row = db.scalar(select(OutboxEmail))
    assert row.attempts == MAX_ATTEMPTS

    working = Transport()
    assert send_pending(db, sending, working) == 0  # left alone for a human
    assert working.sent == []


class TestTick:
    def test_expires_overdue_orders_without_a_request(
        self, frozen_clock, db, client, address, products, sending
    ):
        add(client, products["KIT-001"], 2)
        number = place(client, address).json()["order_number"]
        before = products["KIT-001"].stock_qty
        travel(minutes=31)

        done = worker.tick(db, sending)

        assert done["expired"] == 1
        db.refresh(products["KIT-001"])
        assert products["KIT-001"].stock_qty == before + 2  # ORD-01 stock released
        assert db.scalar(
            select(OutboxEmail.subject).where(OutboxEmail.subject.like(f"%{number} expired"))
        )

    def test_delivers_the_outbox(self, db, sending, queued, monkeypatch):
        queued(1)
        transport = Transport()
        monkeypatch.setattr("app.services.email.smtp_transport", transport)
        assert worker.tick(db, sending)["emails_sent"] == 1
        assert transport.sent == [("to0@e2e.test", "Subject 0")]

    def test_a_failing_job_does_not_stop_the_others(self, db, sending, queued, monkeypatch):
        """A broken sweep must not block email delivery (and the tick never raises)."""

        def boom(_db):
            raise RuntimeError("sweep exploded")

        monkeypatch.setattr("app.services.orders.expire_overdue", boom)
        monkeypatch.setattr("app.services.email.smtp_transport", Transport())
        queued(1)
        assert worker.tick(db, sending) == {"expired": 0, "emails_sent": 1}
