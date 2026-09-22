"""Test-only endpoints so E2E suites can put the app in a known state.

Mounted only when settings.test_endpoints_active (never in prod).
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.errors import AppError
from app.db import get_db
from app.models import OutboxEmail, Product
from app.seed.run import reset_and_seed

router = APIRouter(prefix="/test", tags=["test-support"])


class ResetResponse(BaseModel):
    reset: bool
    seeded: dict[str, int]


@router.post("/reset", response_model=ResetResponse)
def reset_database(db: Session = Depends(get_db)) -> ResetResponse:
    """Wipe every table, reload the deterministic seed data and reset the clock."""
    clock.reset()
    return ResetResponse(reset=True, seeded=reset_and_seed(db))


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


# --- Product state ----------------------------------------------------------------------------


class ProductChange(BaseModel):
    price_cents: int | None = Field(default=None, ge=0)
    stock_qty: int | None = Field(default=None, ge=0)
    is_archived: bool | None = None


class ProductState(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: str
    price_cents: int
    stock_qty: int
    is_archived: bool


@router.patch("/products/{sku}", response_model=ProductState)
def change_product(sku: str, change: ProductChange, db: Session = Depends(get_db)):
    """Simulate a price change, stock drop or archiving (until admin tools exist in M6).
    Global state: E2E tests that use this belong in the 'isolated' project."""
    product = db.scalar(select(Product).where(Product.sku == sku))
    if product is None:
        raise AppError(404, "product_not_found", "Product not found.")
    for field, value in change.model_dump(exclude_none=True).items():
        setattr(product, field, value)
    db.commit()
    return product


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
