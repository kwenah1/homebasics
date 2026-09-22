from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.models import ReturnReason, ReturnStatus
from app.schemas.common import StrictModel
from app.schemas.types import DbId

Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class ReturnLineIn(StrictModel):
    product_id: DbId
    quantity: int = Field(ge=1, le=10)


class ReturnCreate(StrictModel):
    items: list[ReturnLineIn] = Field(min_length=1, max_length=50)
    reason: ReturnReason
    note: Note | None = None

    @field_validator("items")
    @classmethod
    def one_line_per_product(cls, items: list[ReturnLineIn]) -> list[ReturnLineIn]:
        ids = [i.product_id for i in items]
        if len(ids) != len(set(ids)):
            raise ValueError("List each product once.")
        return items


class StaffNote(StrictModel):
    note: Note | None = None


class RejectIn(StrictModel):
    # RET-03: a rejection always tells the shopper why.
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class ReceiveIn(StrictModel):
    restock: bool  # RET-04: damaged goods are refunded but don't go back on the shelf
    note: Note | None = None


class ReturnLineOut(BaseModel):
    product_id: int
    sku: str
    product_name: str
    unit_price_cents: int
    quantity: int


class ReturnOut(BaseModel):
    return_number: str
    order_number: str
    status: ReturnStatus
    reason: ReturnReason
    note: str | None
    staff_note: str | None
    items: list[ReturnLineOut]
    value_cents: int  # the returned goods at the price paid per unit, before discount and tax
    refund_cents: int | None  # set when received
    restocked: bool | None
    created_at: datetime
    updated_at: datetime
    can_cancel: bool


class AdminReturnOut(ReturnOut):
    customer_email: str
    customer_name: str


class Returnable(BaseModel):
    product_id: int
    sku: str
    product_name: str
    quantity: int  # still returnable: ordered minus open or completed returns


class ReturnWindow(BaseModel):
    can_return: bool
    return_by: datetime | None
    returnable: list[Returnable]
