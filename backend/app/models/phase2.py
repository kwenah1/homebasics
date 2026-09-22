"""Phase 2 tables: coupons (CPN), reviews (REV), wishlist (WSH), returns (RET)."""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.catalog import Product
from app.models.enums import CouponKind, ReturnReason, ReturnStatus
from app.models.enums import db_enum as _enum
from app.models.order import Order, OrderItem
from app.models.user import User


class Coupon(TimestampMixin, Base):
    __tablename__ = "coupons"
    __table_args__ = (
        # CPN-01: exactly one of the two amounts, matching the kind.
        CheckConstraint(
            "(kind = 'percent' AND percent_off BETWEEN 1 AND 100 AND amount_off_cents IS NULL)"
            " OR (kind = 'fixed' AND amount_off_cents >= 1 AND percent_off IS NULL)",
            name="amount_matches_kind",
        ),
        CheckConstraint("min_subtotal_cents >= 0", name="min_subtotal_non_negative"),
        CheckConstraint(
            "max_redemptions IS NULL OR max_redemptions >= 1", name="max_redemptions_positive"
        ),
        CheckConstraint("per_user_limit >= 1", name="per_user_limit_positive"),
        CheckConstraint(
            "starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at",
            name="window_ordered",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # uppercase
    description: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    kind: Mapped[CouponKind] = mapped_column(_enum(CouponKind), nullable=False)
    percent_off: Mapped[int | None] = mapped_column(Integer)
    amount_off_cents: Mapped[int | None] = mapped_column(Integer)
    min_subtotal_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_redemptions: Mapped[int | None] = mapped_column(Integer)  # None = unlimited
    per_user_limit: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class CouponRedemption(Base):
    """One row per order that used a coupon. A cancelled or expired order no longer counts
    towards the limits (CPN-04), so the use is 'given back' without deleting history."""

    __tablename__ = "coupon_redemptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    coupon_id: Mapped[int] = mapped_column(ForeignKey("coupons.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    coupon: Mapped[Coupon] = relationship()
    order: Mapped[Order] = relationship()


class Review(TimestampMixin, Base):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("product_id", "user_id", name="uq_reviews_product_user"),  # REV-02
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    title: Mapped[str | None] = mapped_column(String(100))
    body: Mapped[str | None] = mapped_column(Text)

    product: Mapped[Product] = relationship()
    user: Mapped[User] = relationship()


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_wishlist_user_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship()


class ReturnRequest(TimestampMixin, Base):
    __tablename__ = "returns"
    __table_args__ = (
        CheckConstraint("refund_cents IS NULL OR refund_cents >= 0", name="refund_non_negative"),
        # A refund amount exists exactly when the goods were received (RET-04).
        CheckConstraint(
            "(status = 'received') = (refund_cents IS NOT NULL)", name="refund_iff_received"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    return_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    status: Mapped[ReturnStatus] = mapped_column(
        _enum(ReturnStatus), default=ReturnStatus.REQUESTED, nullable=False
    )
    reason: Mapped[ReturnReason] = mapped_column(_enum(ReturnReason), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500))
    staff_note: Mapped[str | None] = mapped_column(String(500))
    restocked: Mapped[bool | None] = mapped_column(Boolean)
    refund_cents: Mapped[int | None] = mapped_column(Integer)

    order: Mapped[Order] = relationship()
    user: Mapped[User] = relationship()
    items: Mapped[list["ReturnItem"]] = relationship(
        back_populates="return_request", cascade="all, delete-orphan"
    )


class ReturnItem(Base):
    __tablename__ = "return_items"
    __table_args__ = (
        CheckConstraint("quantity >= 1", name="quantity_positive"),
        UniqueConstraint("return_id", "order_item_id", name="uq_return_items_line"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    return_id: Mapped[int] = mapped_column(
        ForeignKey("returns.id", ondelete="CASCADE"), index=True, nullable=False
    )
    order_item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    return_request: Mapped[ReturnRequest] = relationship(back_populates="items")
    order_item: Mapped[OrderItem] = relationship()
