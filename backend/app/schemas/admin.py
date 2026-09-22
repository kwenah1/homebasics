from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import InventoryReason, OrderStatus
from app.schemas.checkout import OrderOut
from app.schemas.common import StrictModel
from app.schemas.types import DbId

# Pydantic checks the pattern BEFORE to_upper, so the pattern must accept either case.
Sku = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9]{2,8}-[A-Za-z0-9]{2,12}$"
    ),
]
ProductName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=160)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
MAX_PRICE_CENTS = 1_000_000  # $10,000 - anything above is almost certainly a typo


# --- Products -------------------------------------------------------------------------------


class ProductCreate(StrictModel):
    category_id: DbId
    sku: Sku
    name: ProductName
    description: Description = ""
    price_cents: int = Field(ge=1, le=MAX_PRICE_CENTS)
    initial_stock: int = Field(default=0, ge=0, le=100_000)


class ProductUpdate(StrictModel):
    """SKU and slug never change (URLs and orders refer to them); stock changes only via
    stock adjustments so every unit is accounted for in the ledger (ADM-02)."""

    category_id: DbId | None = None
    name: ProductName | None = None
    description: Description | None = None
    price_cents: int | None = Field(default=None, ge=1, le=MAX_PRICE_CENTS)


class AdminProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: str
    slug: str
    name: str
    description: str
    price_cents: int
    stock_qty: int  # exact - admins see what customers don't (CAT-05a)
    is_archived: bool
    category_id: int
    category_name: str
    created_at: datetime
    updated_at: datetime


class AdminProductPage(BaseModel):
    items: list[AdminProductOut]
    total: int
    page: int
    page_size: int


# --- Stock -------------------------------------------------------------------------------------

AdjustReason = Literal["restock", "adjustment", "damaged"]


class StockAdjustment(StrictModel):
    delta: int = Field(ge=-100_000, le=100_000)
    reason: AdjustReason
    note: Note | None = None


class MovementOut(BaseModel):
    id: int
    delta: int
    reason: InventoryReason
    order_number: str | None
    actor_email: str | None
    note: str | None
    created_at: datetime


class StockLedger(BaseModel):
    product_id: int
    stock_qty: int
    ledger_total: int  # sum of every movement; must always equal stock_qty
    movements: list[MovementOut]


# --- Categories --------------------------------------------------------------------------------


class CategoryCreate(StrictModel):
    name: CategoryName
    description: Description | None = None


class CategoryUpdate(StrictModel):
    name: CategoryName | None = None
    description: Description | None = None


class AdminCategoryOut(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None
    active_products: int
    archived_products: int


# --- Orders ------------------------------------------------------------------------------------


class AdminStatusChange(StrictModel):
    to: Literal["processing", "shipped", "delivered", "cancelled"]
    note: Note | None = None


class RefundIn(StrictModel):
    note: Note | None = None


class AdminOrderSummary(BaseModel):
    order_number: str
    status: OrderStatus
    placed_at: datetime
    customer_email: str
    item_count: int
    total_cents: int


class AdminOrderPage(BaseModel):
    items: list[AdminOrderSummary]
    total: int
    page: int
    page_size: int


class AdminOrderOut(OrderOut):
    customer_email: str
    customer_name: str
    # What an admin may do next, straight from the state machine.
    next_statuses: list[OrderStatus]


class LowStockItem(BaseModel):
    id: int
    sku: str
    name: str
    stock_qty: int


class AdminSummary(BaseModel):
    orders_by_status: dict[str, int]
    awaiting_fulfilment: int  # paid + processing
    low_stock: list[LowStockItem]
