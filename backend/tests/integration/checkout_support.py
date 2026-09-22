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
