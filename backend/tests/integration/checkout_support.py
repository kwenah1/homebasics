"""Shared checkout helpers and fixtures for the order, coupon, return and review tests."""

import uuid

import pytest
from sqlalchemy import select

from app.models import Product
from app.services.payments import SUCCESS_CARD
from tests.helpers import VALID_ADDRESS

QUOTE = "/api/v1/checkout/quote"
PLACE = "/api/v1/checkout/place-order"
CARD = {
    "card_number": SUCCESS_CARD,
    "exp_month": 12,
    "exp_year": 2035,
    "cvc": "123",
    "name_on_card": "Casey Customer",
}


def key() -> str:
    return uuid.uuid4().hex


@pytest.fixture
def products(db):
    return {p.sku: p for p in db.scalars(select(Product))}


@pytest.fixture
def address(client, customer):
    """Default Texas address for the signed-in customer."""
    return client.post("/api/v1/me/addresses", json=VALID_ADDRESS).json()


def add(client, product, qty=1):
    assert (
        client.post(
            "/api/v1/cart/items", json={"product_id": product.id, "quantity": qty}
        ).status_code
        == 200
    )


def quote(client, address, method="standard"):
    return client.post(QUOTE, json={"address_id": address["id"], "shipping_method": method}).json()


def place(client, address, method="standard", *, idem=None, expected=None):
    if expected is None:
        expected = quote(client, address, method)["total_cents"]
    return client.post(
        PLACE,
        json={
            "address_id": address["id"],
            "shipping_method": method,
            "expected_total_cents": expected,
        },
        headers={"Idempotency-Key": idem or key()},
    )


def pay(client, number, card=None, *, idem=None, **overrides):
    return client.post(
        f"/api/v1/orders/{number}/pay",
        json={**CARD, **({"card_number": card} if card else {}), **overrides},
        headers={"Idempotency-Key": idem or key()},
    )


def stock(db, product):
    db.refresh(product)
    return product.stock_qty


def place_with(client, address, *, coupon=None, method="standard", idem=None):
    """Quote (optionally with a coupon) and place at exactly the quoted total."""
    body = {"address_id": address["id"], "shipping_method": method}
    if coupon:
        body["coupon_code"] = coupon
    q = client.post(QUOTE, json=body)
    assert q.status_code == 200, q.text
    return client.post(
        PLACE,
        json={**body, "expected_total_cents": q.json()["total_cents"]},
        headers={"Idempotency-Key": idem or key()},
    )


@pytest.fixture
def pending(client, address, products):
    add(client, products["KIT-001"], 2)
    return place(client, address).json()


def deliver(client, number, admin_headers):
    """Pay (if needed) and walk an order to DELIVERED as staff."""
    order = client.get(f"/api/v1/orders/{number}").json()
    if order["status"] == "pending_payment":
        assert pay(client, number).status_code == 200
    for target in ("processing", "shipped", "delivered"):
        r = client.post(
            f"/api/v1/admin/orders/{number}/status", json={"to": target}, headers=admin_headers
        )
        assert r.status_code == 200, r.text


def order_row(db, user, product, status="delivered", *, quantity=1, delivered_at=None):
    """Insert a finished order straight into the database - for tests that only need 'this
    shopper bought that product' (reviews), not the whole checkout journey."""
    from decimal import Decimal

    from app.core import clock
    from app.models import Order, OrderItem, OrderStatus, ShippingMethod
    from app.services.orders import new_order_number

    line = product.price_cents * quantity
    order = Order(
        order_number=new_order_number(),
        user_id=user.id,
        idempotency_key=key(),
        request_hash="test",
        status=OrderStatus(status),
        shipping_method=ShippingMethod.STANDARD,
        ship_name="Test Shopper",
        ship_line1="1 Test St",
        ship_city="Austin",
        ship_state="TX",
        ship_postal_code="78701",
        subtotal_cents=line,
        discount_cents=0,
        tax_rate=Decimal(0),
        tax_cents=0,
        shipping_cents=0,
        total_cents=line,
        placed_at=clock.now(),
        delivered_at=delivered_at,
    )
    db.add(order)
    db.flush()
    db.add(
        OrderItem(
            order_id=order.id,
            product_id=product.id,
            sku=product.sku,
            product_name=product.name,
            unit_price_cents=product.price_cents,
            quantity=quantity,
            line_total_cents=line,
        )
    )
    db.flush()
    return order
