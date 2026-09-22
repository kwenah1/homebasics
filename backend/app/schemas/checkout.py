from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.models import OrderStatus, PaymentStatus, ShippingMethod
from app.schemas.cart import CartLineOut
from app.schemas.common import StrictModel
from app.schemas.types import INT4_MAX, DbId

# Keys are scoped per shopper and stored as "<user id>:<key>", so they are capped at 48 chars.
IDEMPOTENCY_KEY_PATTERN = r"^[A-Za-z0-9_-]{8,48}$"


class QuoteIn(StrictModel):
    address_id: DbId
    shipping_method: ShippingMethod = ShippingMethod.STANDARD


class PlaceOrderIn(QuoteIn):
    # The total the shopper saw and agreed to. If anything changed since, we refuse (409).
    expected_total_cents: int = Field(ge=0, le=INT4_MAX)


class ShippingOption(BaseModel):
    method: ShippingMethod
    cents: int


class QuoteOut(BaseModel):
    lines: list[CartLineOut]
    item_count: int
    subtotal_cents: int
    discount_cents: int
    tax_rate: float
    tax_state: str
    tax_cents: int
    shipping_method: ShippingMethod
    shipping_cents: int
    total_cents: int
    shipping_options: list[ShippingOption]
    can_place_order: bool
    blocking_reason: str | None


CardNumber = Annotated[str, StringConstraints(strip_whitespace=True, min_length=12, max_length=23)]


class PayIn(StrictModel):
    card_number: CardNumber
    exp_month: int = Field(ge=1, le=12)
    exp_year: int = Field(ge=2000, le=2100)
    cvc: Annotated[str, StringConstraints(pattern=r"^\d{3,4}$")]
    name_on_card: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
    ]

    @field_validator("card_number")
    @classmethod
    def digits_only(cls, value: str) -> str:
        cleaned = "".join(ch for ch in value if ch not in " -")
        if not cleaned.isdigit():
            raise ValueError("Card number must contain only digits.")
        return value


class OrderItemOut(BaseModel):
    product_id: int
    sku: str
    product_name: str
    unit_price_cents: int
    quantity: int
    line_total_cents: int


class StatusEventOut(BaseModel):
    from_status: OrderStatus | None
    to_status: OrderStatus
    at: datetime
    note: str | None


class PaymentOut(BaseModel):
    status: PaymentStatus
    amount_cents: int
    card_last4: str
    failure_reason: str | None
    at: datetime


class AddressSnapshot(BaseModel):
    name: str
    line1: str
    line2: str | None
    city: str
    state: str
    postal_code: str


class OrderSummary(BaseModel):
    order_number: str
    status: OrderStatus
    placed_at: datetime
    item_count: int
    total_cents: int


class OrderOut(BaseModel):
    order_number: str
    status: OrderStatus
    placed_at: datetime
    payment_expires_at: datetime | None
    shipping_method: ShippingMethod
    ship_to: AddressSnapshot
    items: list[OrderItemOut]
    subtotal_cents: int
    discount_cents: int
    tax_rate: float
    tax_cents: int
    shipping_cents: int
    total_cents: int
    history: list[StatusEventOut]
    payments: list[PaymentOut]
    can_pay: bool
    can_cancel: bool


class OrderPage(BaseModel):
    items: list[OrderSummary]
    total: int
    page: int
    page_size: int
