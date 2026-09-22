from enum import StrEnum

from sqlalchemy import Enum


def db_enum(enum_cls: type[StrEnum]) -> Enum:
    """Store enum *values* as VARCHAR + CHECK (no native PG enum = painless migrations)."""
    return Enum(
        enum_cls, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e]
    )


class UserRole(StrEnum):
    CUSTOMER = "customer"
    ADMIN = "admin"


class OrderStatus(StrEnum):
    """Order state machine - see docs/BRD.md section ORD."""

    PENDING_PAYMENT = "pending_payment"
    PAID = "paid"
    PROCESSING = "processing"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    REFUNDED = "refunded"


class ShippingMethod(StrEnum):
    STANDARD = "standard"
    EXPRESS = "express"


class PaymentStatus(StrEnum):
    SUCCEEDED = "succeeded"
    DECLINED = "declined"
    FAILED = "failed"
    REFUNDED = "refunded"  # a refund of an earlier successful payment (cancellation)


class InventoryReason(StrEnum):
    INITIAL = "initial"
    RESTOCK = "restock"
    ADJUSTMENT = "adjustment"
    DAMAGED = "damaged"
    ORDER_PLACED = "order_placed"
    ORDER_CANCELLED = "order_cancelled"
    ORDER_EXPIRED = "order_expired"
