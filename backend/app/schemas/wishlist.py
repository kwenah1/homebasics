from datetime import datetime

from pydantic import BaseModel

from app.schemas.catalog import ProductSummary


class WishlistItemOut(BaseModel):
    product: ProductSummary
    added_at: datetime
    # WSH-03: archived products stay on the list (greyed out) rather than vanishing.
    available: bool


class WishlistOut(BaseModel):
    items: list[WishlistItemOut]
    count: int
    limit: int
