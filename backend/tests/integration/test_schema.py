"""Database-level guarantees: constraints hold even if the service layer has a bug."""

from decimal import Decimal

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Base, Order, Product, ShippingMethod, User


def test_migrations_match_models(connection):
    """Fails if someone changes a model without generating a migration."""
    ctx = MigrationContext.configure(connection, opts={"compare_type": True})
    assert compare_metadata(ctx, Base.metadata) == []


def test_seeded_archived_product_exists(db):
    archived = db.scalars(select(Product).where(Product.is_archived)).all()
    assert [p.sku for p in archived] == ["KIT-900"]


@pytest.mark.parametrize(("field", "value"), [("price_cents", -1), ("stock_qty", -1)])
def test_product_rejects_negative_values(db, field, value):
    product = db.scalar(select(Product).where(Product.sku == "KIT-001"))
    setattr(product, field, value)
    with pytest.raises(IntegrityError):
        db.flush()


def test_email_unique_ignoring_case(db):
    """ACC-01"""
    db.add(User(email="CUSTOMER@HomeBasics.test", password_hash="x", first_name="A", last_name="B"))
    with pytest.raises(IntegrityError, match="uq_users_email_lower"):
        db.flush()


def _order(user_id: int, **money) -> Order:
    defaults = dict(
        subtotal_cents=1000, discount_cents=0, tax_cents=83, shipping_cents=599, total_cents=1682
    )
    defaults.update(money)
    return Order(
        order_number="HB-TEST-1",
        user_id=user_id,
        idempotency_key="schema-test-key",
        request_hash="0" * 64,
        shipping_method=ShippingMethod.STANDARD,
        ship_name="Casey",
        ship_line1="1 Main St",
        ship_city="Austin",
        ship_state="TX",
        ship_postal_code="78701",
        tax_rate=Decimal("0.0825"),
        **defaults,
    )


def test_order_total_must_add_up(db):
    user = db.scalar(select(User).where(User.email == "customer@homebasics.test"))
    db.add(_order(user.id, total_cents=1))
    with pytest.raises(IntegrityError, match="total_adds_up"):
        db.flush()


def test_valid_order_is_accepted_with_pending_status(db):
    user = db.scalar(select(User).where(User.email == "customer@homebasics.test"))
    order = _order(user.id)
    db.add(order)
    db.flush()
    db.refresh(order)
    assert order.status == "pending_payment"
