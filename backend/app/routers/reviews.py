"""/api/v1/products/{slug}/reviews - REV-01..05. Reading is public; writing needs a sign-in and
a delivered order of the product. A shopper has at most one review per product, addressed as
`/mine`."""

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db import get_db
from app.models import User
from app.schemas.common import SafeStr
from app.schemas.reviews import MyReview, ReviewIn, ReviewOut, ReviewPage, ReviewUpdate
from app.services import reviews as review_service

router = APIRouter(prefix="/products/{slug}/reviews", tags=["reviews"])


@router.get("", response_model=ReviewPage)
def list_reviews(
    slug: SafeStr,
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Newest first, with the product's overall rating and the star breakdown."""
    return review_service.list_reviews(db, slug, page, page_size)


@router.get("/mine", response_model=MyReview)
def my_review(slug: SafeStr, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Whether the shopper may review this product, and their review if they have one."""
    return review_service.my_review(db, user, slug)


@router.post(
    "",
    response_model=ReviewOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        403: {"description": "No delivered order of this product"},
        409: {"description": "Already reviewed - edit the existing review"},
    },
)
def create_review(
    slug: SafeStr,
    data: ReviewIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return review_service.create_review(db, user, slug, data)


@router.patch("/mine", response_model=ReviewOut)
def update_review(
    slug: SafeStr,
    data: ReviewUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return review_service.update_review(db, user, slug, data)


@router.delete("/mine", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(
    slug: SafeStr, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    review_service.delete_review(db, user, slug)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
