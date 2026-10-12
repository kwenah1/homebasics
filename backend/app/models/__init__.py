"""Import every model here so Base.metadata is complete for Alembic and tests."""

from app.models.auth import OutboxEmail, PasswordResetToken, RefreshToken
from app.models.base import Base
from app.models.cart import Cart, CartItem
from app.models.catalog import Category, Product, ProductImage
from app.models.enums import (
    CouponKind,
    InventoryReason,
    OrderStatus,
    PaymentStatus,
    ReturnReason,
    ReturnStatus,
    ShippingMethod,
    UserRole,
)
from app.models.inventory import InventoryMovement
from app.models.order import Order, OrderItem, OrderStatusHistory, Payment, TaxRate
from app.models.phase2 import (
    Coupon,
    CouponRedemption,
    ReturnItem,
    ReturnRequest,
    Review,
    WishlistItem,
)
from app.models.user import Address, User

__all__ = [
    "Address",
    "Base",
    "Cart",
    "CartItem",
    "Category",
    "Coupon",
    "CouponKind",
    "CouponRedemption",
    "InventoryMovement",
    "InventoryReason",
    "Order",
    "OrderItem",
    "OrderStatus",
    "OrderStatusHistory",
    "OutboxEmail",
    "PasswordResetToken",
    "Payment",
    "PaymentStatus",
    "Product",
    "ProductImage",
    "RefreshToken",
    "ReturnItem",
    "ReturnReason",
    "ReturnRequest",
    "ReturnStatus",
    "Review",
    "ShippingMethod",
    "TaxRate",
    "User",
    "UserRole",
    "WishlistItem",
]
