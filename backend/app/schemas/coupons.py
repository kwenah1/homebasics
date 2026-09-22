from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field, model_validator

from app.models import CouponKind
from app.schemas.common import StrictModel
from app.schemas.types import INT4_MAX


def _upper(value: str) -> str:
    return value.strip().upper()


# CPN-01: codes are case-insensitive for shoppers and stored uppercase.
CouponCode = Annotated[
    str,
    Field(min_length=3, max_length=20, pattern=r"^\s*[A-Za-z0-9-]+\s*$"),
    AfterValidator(_upper),
]
Cents = Annotated[int, Field(ge=0, le=INT4_MAX)]

CouponState = Literal["scheduled", "active", "expired", "exhausted", "disabled"]


class _Window(StrictModel):
    starts_at: AwareDatetime | None = None
    expires_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def window_ordered(self):
        if self.starts_at and self.expires_at and self.starts_at >= self.expires_at:
            raise ValueError("Expiry must be after the start.")
        return self


class CouponCreate(_Window):
    code: CouponCode
    description: str = Field(default="", max_length=200)
    kind: CouponKind
    percent_off: int | None = Field(default=None, ge=1, le=100)
    amount_off_cents: int | None = Field(default=None, ge=1, le=INT4_MAX)
    min_subtotal_cents: Cents = 0
    max_redemptions: int | None = Field(default=None, ge=1, le=1_000_000)
    per_user_limit: int = Field(default=1, ge=1, le=100)
    is_active: bool = True

    @model_validator(mode="after")
    def amount_matches_kind(self):
        if self.kind == CouponKind.PERCENT and (
            self.percent_off is None or self.amount_off_cents is not None
        ):
            raise ValueError("A percent coupon needs percent_off (and no amount_off_cents).")
        if self.kind == CouponKind.FIXED and (
            self.amount_off_cents is None or self.percent_off is not None
        ):
            raise ValueError("A fixed coupon needs amount_off_cents (and no percent_off).")
        return self


class CouponUpdate(_Window):
    """ADM-05: code, kind and amount are fixed once created - orders refer to them."""

    description: str | None = Field(default=None, max_length=200)
    min_subtotal_cents: Cents | None = None
    max_redemptions: int | None = Field(default=None, ge=1, le=1_000_000)
    per_user_limit: int | None = Field(default=None, ge=1, le=100)
    is_active: bool | None = None


class CouponOut(BaseModel):
    id: int
    code: str
    description: str
    kind: CouponKind
    percent_off: int | None
    amount_off_cents: int | None
    min_subtotal_cents: int
    starts_at: datetime | None
    expires_at: datetime | None
    max_redemptions: int | None
    per_user_limit: int
    is_active: bool
    uses: int  # redemptions by orders that weren't cancelled or expired
    state: CouponState


class AppliedCoupon(BaseModel):
    code: str
    description: str
    discount_cents: int
