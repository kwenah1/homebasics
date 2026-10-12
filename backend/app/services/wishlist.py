"""Wishlist (WSH-01..04): a signed-in shopper's saved products.

Adding is idempotent (saving twice is not an error) and so is removing. Archived products stay
on the list marked unavailable, so a shopper can see what went away instead of wondering.
"""

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload

from app.core.errors import AppError
from app.models import Product, User, WishlistItem
from app.schemas.cart import CartOut
from app.schemas.catalog import ProductSummary
from app.schemas.wishlist import WishlistItemOut, WishlistOut
from app.services import cart as cart_service
from app.services.catalog import _summary

WISHLIST_LIMIT = 50  # WSH-02


def get_wishlist(db: Session, user: User) -> WishlistOut:
    rows = db.scalars(
        select(WishlistItem)
        .where(WishlistItem.user_id == user.id)
        .options(joinedload(WishlistItem.product).joinedload(Product.category))
        .order_by(WishlistItem.created_at.desc(), WishlistItem.id.desc())
    ).all()
    return WishlistOut(
        items=[
            WishlistItemOut(
                product=ProductSummary(**_summary(row.product)),
                added_at=row.created_at,
                available=not row.product.is_archived,
            )
            for row in rows
        ],
        count=len(rows),
        limit=WISHLIST_LIMIT,
    )


def add(db: Session, user: User, product_id: int) -> WishlistOut:
    product = db.get(Product, product_id)
    if product is None or product.is_archived:
        raise AppError(404, "product_not_found", "Product not found.")
    cart_service.lock_cart(db, user)  # serialises this shopper's list changes (limit check)
    count = db.scalar(
        select(func.count()).select_from(WishlistItem).where(WishlistItem.user_id == user.id)
    )
    already = db.scalar(
        select(WishlistItem.id).where(
            WishlistItem.user_id == user.id, WishlistItem.product_id == product_id
        )
    )
    if already is None and count >= WISHLIST_LIMIT:
        raise AppError(
            409,
            "wishlist_full",
            f"Your wishlist can hold {WISHLIST_LIMIT} items. Remove one first.",
            extra={"limit": WISHLIST_LIMIT},
        )
    # ON CONFLICT DO NOTHING: two tabs saving the same product at once is still one row.
    db.execute(
        insert(WishlistItem)
        .values(user_id=user.id, product_id=product_id)
        .on_conflict_do_nothing(constraint="uq_wishlist_user_product")
    )
    db.commit()
    return get_wishlist(db, user)


def remove(db: Session, user: User, product_id: int) -> None:
    row = db.scalar(
        select(WishlistItem).where(
            WishlistItem.user_id == user.id, WishlistItem.product_id == product_id
        )
    )
    if row is not None:
        db.delete(row)
        db.commit()


def move_to_cart(db: Session, user: User, product_id: int) -> CartOut:
    """WSH-04: one unit into the cart under the usual cart rules, then off the list. If the
    cart refuses (out of stock, line limit), the product stays on the wishlist."""
    on_list = db.scalar(
        select(WishlistItem.id).where(
            WishlistItem.user_id == user.id, WishlistItem.product_id == product_id
        )
    )
    if on_list is None:
        raise AppError(404, "not_in_wishlist", "That product isn't on your wishlist.")
    cart = cart_service.add_item(db, user, product_id, 1)
    remove(db, user, product_id)
    return cart
