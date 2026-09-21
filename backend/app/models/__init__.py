"""Import every model here so Base.metadata is complete for Alembic and tests."""

from app.models.base import Base
from app.models.cart import Cart, CartItem
from app.models.catalog import Category, Product, ProductImage
from app.models.enums import (
    InventoryReason,
    OrderStatus,
    PaymentStatus,
    ShippingMethod,
    UserRole,
)
from app.models.inventory import InventoryMovement
from app.models.order import Order, OrderItem, OrderStatusHistory, Payment, TaxRate
from app.models.user import Address, User

__all__ = [
    "Address",
    "Base",
    "Cart",
    "CartItem",
    "Category",
    "InventoryMovement",
    "InventoryReason",
    "Order",
    "OrderItem",
    "OrderStatus",
    "OrderStatusHistory",
    "Payment",
    "PaymentStatus",
    "Product",
    "ProductImage",
    "ShippingMethod",
    "TaxRate",
    "User",
    "UserRole",
]
