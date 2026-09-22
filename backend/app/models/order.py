from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.enums import OrderStatus, PaymentStatus, ShippingMethod
from app.models.enums import db_enum as _enum


class TaxRate(Base):
    """CHK-02: flat sales-tax rate per US state (simplified for the exercise)."""

    __tablename__ = "tax_rates"
    __table_args__ = (CheckConstraint("rate >= 0 AND rate < 0.2", name="rate_range"),)

    state_code: Mapped[str] = mapped_column(String(2), primary_key=True)
    state_name: Mapped[str] = mapped_column(String(40), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)  # 0.08250 = 8.25%


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "total_cents = subtotal_cents - discount_cents + tax_cents + shipping_cents",
            name="total_adds_up",
        ),
        CheckConstraint("total_cents >= 0", name="total_non_negative"),
        # CHK-08: one order per (shopper, Idempotency-Key) - a double submit can't make two.
        UniqueConstraint("user_id", "idempotency_key", name="uq_orders_user_idempotency_key"),
        # ORD-01: the expiry sweep looks for overdue unpaid orders.
        Index("ix_orders_status_payment_expires_at", "status", "payment_expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # Fingerprint of the request body: replaying a key with a *different* request is refused.
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[OrderStatus] = mapped_column(
        _enum(OrderStatus), default=OrderStatus.PENDING_PAYMENT, index=True, nullable=False
    )
    shipping_method: Mapped[ShippingMethod] = mapped_column(_enum(ShippingMethod), nullable=False)

    # Shipping address snapshot - later edits to the address book never change an order.
    ship_name: Mapped[str] = mapped_column(String(160), nullable=False)
    ship_line1: Mapped[str] = mapped_column(String(200), nullable=False)
    ship_line2: Mapped[str | None] = mapped_column(String(200))
    ship_city: Mapped[str] = mapped_column(String(100), nullable=False)
    ship_state: Mapped[str] = mapped_column(String(2), nullable=False)
    ship_postal_code: Mapped[str] = mapped_column(String(10), nullable=False)

    # CHK-01 / CHK-05: money in cents, tax rate snapshotted at placement.
    subtotal_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)
    tax_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    shipping_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    placed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # ORD: PENDING_PAYMENT orders expire after 30 minutes and restock inventory.
    payment_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # RET-01: the 30-day return window runs from here (set from the controllable clock).
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    coupon_code: Mapped[str | None] = mapped_column(String(20))  # CPN: snapshot for display

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    payments: Mapped[list["Payment"]] = relationship(back_populates="order")
    status_history: Mapped[list["OrderStatusHistory"]] = relationship(
        back_populates="order", order_by="OrderStatusHistory.id"
    )


class OrderItem(Base):
    """CHK-06: price and name are snapshotted at placement."""

    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("quantity BETWEEN 1 AND 10", name="quantity_range"),
        CheckConstraint("line_total_cents = unit_price_cents * quantity", name="line_total"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    sku: Mapped[str] = mapped_column(String(32), nullable=False)
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    unit_price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    line_total_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True, nullable=False)
    # CHK-08: a repeated submit with the same key returns the original result.
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    request_hash: Mapped[str | None] = mapped_column(String(64))
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(_enum(PaymentStatus), nullable=False)
    card_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    order: Mapped[Order] = relationship(back_populates="payments")


class OrderStatusHistory(Base):
    """ORD-03: audit trail of every status change."""

    __tablename__ = "order_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    from_status: Mapped[OrderStatus | None] = mapped_column(_enum(OrderStatus))
    to_status: Mapped[OrderStatus] = mapped_column(_enum(OrderStatus), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    order: Mapped[Order] = relationship(back_populates="status_history")
