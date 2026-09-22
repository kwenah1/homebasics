"""Test-only endpoints so E2E suites can put the app in a known state.

Mounted only when settings.test_endpoints_active (never in prod).
"""

import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from psycopg.errors import DeadlockDetected, LockNotAvailable
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core import clock
from app.core.rate_limit import limiter
from app.db import get_db
from app.models import OutboxEmail
from app.seed.run import reset_and_seed
from app.services import orders as order_service

router = APIRouter(prefix="/test", tags=["test-support"])


class ResetResponse(BaseModel):
    reset: bool
    seeded: dict[str, int]


@router.post("/reset", response_model=ResetResponse)
def reset_database(db: Session = Depends(get_db)) -> ResetResponse:
    """Wipe every table, reload the deterministic seed data and reset the clock.

    TRUNCATE takes exclusive locks table by table, so it can deadlock with a request still
    in flight from the previous test's open page (found by E2E: the expiry sweep holds an
    orders lock and wants products). Postgres aborts one side; the reset is all-or-nothing,
    so retrying it is safe.
    """
    clock.reset()
    limiter.reset()
    for attempt in range(1, 4):
        try:
            return ResetResponse(reset=True, seeded=reset_and_seed(db))
        except DBAPIError as exc:
            db.rollback()
            if attempt == 3 or not isinstance(exc.orig, DeadlockDetected | LockNotAvailable):
                raise
            time.sleep(0.2 * attempt)
    raise AssertionError("unreachable")


# --- Email outbox -----------------------------------------------------------------------


class EmailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    to_address: str
    subject: str
    body: str
    created_at: datetime


@router.get("/emails", response_model=list[EmailOut])
def list_emails(
    to: str = Query(description="Recipient address (case-insensitive)"),
    limit: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Newest first."""
    return db.scalars(
        select(OutboxEmail)
        .where(OutboxEmail.to_address == to.strip().lower())
        .order_by(OutboxEmail.id.desc())
        .limit(limit)
    ).all()


# --- Orders -------------------------------------------------------------------------------


@router.post("/expire-orders")
def expire_orders(db: Session = Depends(get_db)) -> dict[str, int]:
    """Run the ORD-01 expiry sweep now (production would run it on a schedule)."""
    return {"expired": order_service.expire_overdue(db)}


# --- Clock --------------------------------------------------------------------------------


class ClockState(BaseModel):
    now: datetime
    offset_seconds: float
    frozen: bool


class ClockChange(BaseModel):
    advance_seconds: float | None = None
    freeze: bool | None = None
    reset: bool = False


@router.get("/clock", response_model=ClockState)
def get_clock() -> dict:
    return clock.state()


@router.post("/clock", response_model=ClockState)
def change_clock(change: ClockChange) -> dict:
    """Examples: {"advance_seconds": 901} - {"freeze": true} - {"reset": true}."""
    if change.reset:
        clock.reset()
    if change.freeze:
        clock.freeze()
    if change.advance_seconds:
        clock.advance(timedelta(seconds=change.advance_seconds))
    return clock.state()
