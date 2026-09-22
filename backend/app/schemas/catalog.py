from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import InputModel
from app.schemas.types import INT4_MAX

StockStatus = Literal["in_stock", "low_stock", "out_of_stock"]


class ProductSort(StrEnum):
    NAME = "name"
    PRICE_ASC = "price_asc"
    PRICE_DESC = "price_desc"
    NEWEST = "newest"
    RATING = "rating"


class ProductQuery(InputModel):
    """Query string for GET /products. Unknown parameters are rejected (422)."""

    model_config = ConfigDict(extra="forbid")

    category: str | None = Field(default=None, max_length=80, description="Category slug")
    q: str | None = Field(default=None, max_length=100, description="Keywords; all must match")
    min_price_cents: int | None = Field(default=None, ge=0, le=INT4_MAX)
    max_price_cents: int | None = Field(default=None, ge=0, le=INT4_MAX)
    in_stock: bool = False
    sort: ProductSort = ProductSort.NAME
    page: int = Field(default=1, ge=1, le=10_000)
    page_size: int = Field(default=20, ge=1, le=50)  # CAT-01: 20 per page

    @model_validator(mode="after")
    def price_range_ordered(self) -> "ProductQuery":
        if (
            self.min_price_cents is not None
            and self.max_price_cents is not None
            and self.min_price_cents > self.max_price_cents
        ):
            raise ValueError("min_price_cents must not be greater than max_price_cents")
        return self


class CategoryRef(BaseModel):
    slug: str
    name: str


class CategoryOut(CategoryRef):
    id: int
    description: str | None
    product_count: int


class ImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    url: str
    alt_text: str


class ProductSummary(BaseModel):
    id: int
    sku: str
    slug: str
    name: str
    price_cents: int
    category: CategoryRef
    stock_status: StockStatus
    # CAT-05: exact count is revealed only when low (<= 5); otherwise null.
    stock_left: int | None
    rating_avg: float | None
    rating_count: int


class ProductDetail(ProductSummary):
    description: str
    images: list[ImageOut]
    # CRT-01 preview: most you can add in one line (min(10, stock)); 0 when out of stock.
    max_order_qty: int


class ProductPage(BaseModel):
    items: list[ProductSummary]
    total: int
    page: int
    page_size: int
    pages: int
