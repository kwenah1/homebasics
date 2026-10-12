from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from app.schemas.common import StrictModel


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


Title = Annotated[str | None, Field(default=None, max_length=100), AfterValidator(_blank_to_none)]
Body = Annotated[str | None, Field(default=None, max_length=2000), AfterValidator(_blank_to_none)]
Rating = Annotated[int, Field(ge=1, le=5)]


class ReviewIn(StrictModel):
    rating: Rating
    title: Title = None
    body: Body = None


class ReviewUpdate(StrictModel):
    rating: Rating | None = None
    title: Title = None
    body: Body = None


class ReviewOut(BaseModel):
    id: int
    rating: int
    title: str | None
    body: str | None
    author: str  # "Casey C." - never the email or full surname
    verified_purchase: bool  # always true today (REV-01), kept for when that changes
    created_at: datetime
    updated_at: datetime


class ReviewPage(BaseModel):
    items: list[ReviewOut]
    total: int
    page: int
    page_size: int
    # All ratings, including ones collected before written reviews existed (REV-03)...
    rating_avg: float | None
    rating_count: int
    # ...and the star breakdown of the written reviews on this page's list.
    distribution: dict[int, int]


class MyReview(BaseModel):
    can_review: bool
    reason: Literal["not_purchased", "already_reviewed"] | None
    review: ReviewOut | None


class AdminReviewOut(ReviewOut):
    product_id: int
    product_name: str
    product_slug: str
    author_email: str


class AdminReviewPage(BaseModel):
    items: list[AdminReviewOut]
    total: int
    page: int
    page_size: int
