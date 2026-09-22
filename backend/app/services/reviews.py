"""Reviews (REV-01..05): who may review, one per product per shopper, and keeping the product's
rating in step.

REV-03: a product's rating is a star *total* and a count, changed by one relative UPDATE that
also recomputes the average - so two reviews saved at the same moment can't lose an update,
and the average can never drift from the numbers behind it.
"""

from sqlalchemy import Numeric, case, cast, exists, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core import bugs
from app.core.errors import AppError
from app.models import Order, OrderItem, OrderStatus, Product, Review, User
from app.schemas.reviews import (
    AdminReviewOut,
    AdminReviewPage,
    MyReview,
    ReviewIn,
    ReviewOut,
    ReviewPage,
    ReviewUpdate,
)
from app.services.catalog import _visible


def author_name(user: User) -> str:
    return f"{user.first_name} {user.last_name[:1]}.".strip()


def review_out(review: Review) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        rating=review.rating,
        title=review.title,
        body=review.body,
        author=author_name(review.user),
        verified_purchase=True,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


def _product(db: Session, slug: str) -> Product:
    product = db.scalar(_visible().where(Product.slug == slug))
    if product is None:
        raise AppError(404, "product_not_found", "Product not found.")
    return product


def _adjust_rating(db: Session, product_id: int, count_delta: int, stars_delta: int) -> None:
    new_count = Product.rating_count + count_delta
    new_total = Product.rating_total + stars_delta
    db.execute(
        update(Product)
        .where(Product.id == product_id)
        .values(
            rating_count=new_count,
            rating_total=new_total,
            # Postgres ROUND(numeric) rounds halves away from zero - half-up for ratings.
            rating_avg=case(
                (new_count == 0, None),
                else_=func.round(cast(new_total, Numeric) / new_count, 1),
            ),
        )
        .execution_options(synchronize_session=False)
    )


def has_delivered_purchase(db: Session, user: User, product_id: int) -> bool:
    """REV-01: the shopper has an order of this product that reached DELIVERED."""
    statuses = (
        (OrderStatus.DELIVERED, OrderStatus.SHIPPED)
        if bugs.active("review_before_delivery")
        else (OrderStatus.DELIVERED,)
    )
    return db.scalar(
        select(
            exists().where(
                Order.id == OrderItem.order_id,
                Order.user_id == user.id,
                Order.status.in_(statuses),
                OrderItem.product_id == product_id,
            )
        )
    )


def _mine(db: Session, user: User, product: Product) -> Review | None:
    return db.scalar(
        select(Review)
        .where(Review.product_id == product.id, Review.user_id == user.id)
        .options(joinedload(Review.user))
    )


# --- Public ------------------------------------------------------------------------------------


def list_reviews(db: Session, slug: str, page: int, page_size: int) -> ReviewPage:
    product = _product(db, slug)
    total = db.scalar(select(func.count()).where(Review.product_id == product.id))
    rows = db.scalars(
        select(Review)
        .where(Review.product_id == product.id)
        .options(joinedload(Review.user))
        .order_by(Review.created_at.desc(), Review.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    counts = dict(
        db.execute(
            select(Review.rating, func.count())
            .where(Review.product_id == product.id)
            .group_by(Review.rating)
        ).all()
    )
    return ReviewPage(
        items=[review_out(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        rating_avg=float(product.rating_avg) if product.rating_avg is not None else None,
        rating_count=product.rating_count,
        distribution={stars: counts.get(stars, 0) for stars in range(1, 6)},
    )


# --- The signed-in shopper's own review ---------------------------------------------------------


def my_review(db: Session, user: User, slug: str) -> MyReview:
    product = _product(db, slug)
    mine = _mine(db, user, product)
    if mine is not None:
        return MyReview(can_review=False, reason="already_reviewed", review=review_out(mine))
    if not has_delivered_purchase(db, user, product.id):
        return MyReview(can_review=False, reason="not_purchased", review=None)
    return MyReview(can_review=True, reason=None, review=None)


def create_review(db: Session, user: User, slug: str, data: ReviewIn) -> ReviewOut:
    product = _product(db, slug)
    if not has_delivered_purchase(db, user, product.id):
        raise AppError(
            403,
            "review_not_allowed",
            "You can review products from your delivered orders.",
        )
    review = Review(product_id=product.id, user_id=user.id, **data.model_dump())
    db.add(review)
    try:
        db.flush()  # REV-02: the unique (product, user) index decides a double submit
    except IntegrityError:
        db.rollback()
        raise AppError(
            409, "review_exists", "You've already reviewed this product - edit your review."
        ) from None
    _adjust_rating(db, product.id, +1, data.rating)
    db.commit()
    db.refresh(review)
    return review_out(review)


def _require_mine(db: Session, user: User, slug: str) -> tuple[Product, Review]:
    product = _product(db, slug)
    mine = db.scalar(
        select(Review)
        .where(Review.product_id == product.id, Review.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if mine is None:
        raise AppError(404, "review_not_found", "You haven't reviewed this product.")
    return product, mine


def update_review(db: Session, user: User, slug: str, data: ReviewUpdate) -> ReviewOut:
    product, review = _require_mine(db, user, slug)
    changes = data.model_dump(exclude_unset=True)
    if "rating" in changes and changes["rating"] is None:
        raise AppError(
            422, "validation_error", "Some fields are invalid.", fields={"rating": "Required."}
        )
    old_rating = review.rating
    for field, value in changes.items():
        setattr(review, field, value)
    if review.rating != old_rating:
        _adjust_rating(db, product.id, 0, review.rating - old_rating)
    db.commit()
    db.refresh(review)
    return review_out(review)


def _delete(db: Session, review: Review) -> None:
    _adjust_rating(db, review.product_id, -1, -review.rating)
    db.delete(review)
    db.commit()


def delete_review(db: Session, user: User, slug: str) -> None:
    _, review = _require_mine(db, user, slug)
    _delete(db, review)


# --- Admin moderation (ADM-06) ------------------------------------------------------------


def admin_list(db: Session, page: int, page_size: int) -> AdminReviewPage:
    total = db.scalar(select(func.count()).select_from(Review))
    rows = db.scalars(
        select(Review)
        .options(joinedload(Review.user), joinedload(Review.product))
        .order_by(Review.created_at.desc(), Review.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    return AdminReviewPage(
        items=[
            AdminReviewOut(
                **review_out(r).model_dump(),
                product_id=r.product_id,
                product_name=r.product.name,
                product_slug=r.product.slug,
                author_email=r.user.email,
            )
            for r in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


def admin_delete(db: Session, review_id: int) -> None:
    review = db.scalar(
        select(Review)
        .where(Review.id == review_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if review is None:
        raise AppError(404, "review_not_found", "Review not found.")
    _delete(db, review)
