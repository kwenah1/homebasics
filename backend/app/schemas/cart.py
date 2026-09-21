from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.catalog import CategoryRef, StockStatus
from app.schemas.common import StrictModel

MAX_LINE_QTY = 10  # CRT-01
MAX_GUEST_LINES = 50

LineIssue = Literal["unavailable", "out_of_stock", "insufficient_stock"]


class CartItemIn(StrictModel):
    product_id: int = Field(ge=1)
    quantity: int = Field(default=1, ge=1, le=MAX_LINE_QTY)


class CartItemUpdate(StrictModel):
    quantity: int = Field(ge=1, le=MAX_LINE_QTY)


class GuestItem(StrictModel):
    """One line of a browser-side guest cart (CRT-02)."""

    product_id: int = Field(ge=1)
    quantity: int = Field(ge=1, le=MAX_LINE_QTY)
    # Price the guest saw when adding. Used ONLY to show a price-change notice - never to charge.
    price_cents_seen: int | None = Field(default=None, ge=0)


class GuestCartIn(StrictModel):
    items: list[GuestItem] = Field(default_factory=list, max_length=MAX_GUEST_LINES)


class CartLineOut(BaseModel):
    product_id: int
    sku: str
    slug: str
    name: str
    category: CategoryRef
    unit_price_cents: int
    quantity: int
    line_total_cents: int
    # CRT-03: what the price was when this line was added, and how much it has moved since.
    price_when_added_cents: int
    price_change_cents: int
    stock_status: StockStatus
    stock_left: int | None
    max_order_qty: int
    # CRT-04: stock is not reserved, so a line can go bad after it was added.
    issue: LineIssue | None
    available: int | None = Field(description="Units available when issue is insufficient_stock")


class CartOut(BaseModel):
    items: list[CartLineOut]
    item_count: int
    # Only lines without an issue count towards the subtotal.
    subtotal_cents: int
    has_issues: bool
    has_price_changes: bool
    free_shipping_threshold_cents: int
    amount_to_free_shipping_cents: int
    # Preview only: guest cart ids that no longer exist, so the browser can prune them.
    unknown_product_ids: list[int] = Field(default_factory=list)


class CappedLine(BaseModel):
    product_id: int
    requested: int
    kept: int


class SkippedLine(BaseModel):
    product_id: int
    reason: Literal["unavailable", "out_of_stock"]


class MergeReport(BaseModel):
    capped: list[CappedLine]
    skipped: list[SkippedLine]


class MergeOut(BaseModel):
    cart: CartOut
    report: MergeReport
