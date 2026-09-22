"""Stateful (model-based) test of the cart API with Hypothesis.

Hypothesis invents random *sequences* of add / set-quantity / remove / clear / merge calls.
After every step the real API must agree with a tiny in-memory model of the rules. When it
finds a failing sequence it shrinks it to the shortest one that still fails.
"""

import pytest
from hypothesis import HealthCheck, settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, initialize, invariant, rule
from sqlalchemy import select

from app.models import Product

# A few products with interesting stock: plenty, exactly 5, exactly 1, and none.
SKUS = ["KIT-001", "CLN-001", "KIT-005", "CLN-005", "KIT-009"]


@pytest.fixture
def cart_machine(client, customer, db):
    products = {p.sku: p for p in db.scalars(select(Product).where(Product.sku.in_(SKUS)))}

    class CartMachine(RuleBasedStateMachine):
        @initialize()
        def start_empty(self):
            assert client.delete("/api/v1/cart").status_code == 204
            self.model: dict[str, int] = {}

        def limit(self, sku):
            return min(10, products[sku].stock_qty)

        @rule(sku=st.sampled_from(SKUS), qty=st.integers(1, 10))
        def add(self, sku, qty):
            r = client.post(
                "/api/v1/cart/items", json={"product_id": products[sku].id, "quantity": qty}
            )
            if products[sku].stock_qty == 0:
                assert (r.status_code, r.json()["error"]["code"]) == (409, "out_of_stock")
            elif self.model.get(sku, 0) + qty > self.limit(sku):
                assert (r.status_code, r.json()["error"]["code"]) == (409, "quantity_limit")
            else:
                assert r.status_code == 200, r.text
                self.model[sku] = self.model.get(sku, 0) + qty

        @rule(sku=st.sampled_from(SKUS), qty=st.integers(1, 10))
        def set_quantity(self, sku, qty):
            r = client.patch(f"/api/v1/cart/items/{products[sku].id}", json={"quantity": qty})
            if sku not in self.model:
                assert r.status_code == 404
            elif qty > products[sku].stock_qty:
                assert (r.status_code, r.json()["error"]["code"]) == (409, "insufficient_stock")
            else:
                assert r.status_code == 200, r.text
                self.model[sku] = qty

        @rule(sku=st.sampled_from(SKUS))
        def remove(self, sku):
            r = client.delete(f"/api/v1/cart/items/{products[sku].id}")
            assert r.status_code == (200 if sku in self.model else 404)
            self.model.pop(sku, None)

        @rule(sku=st.sampled_from(SKUS), qty=st.integers(1, 10))
        def merge_guest_line(self, sku, qty):
            r = client.post(
                "/api/v1/cart/merge",
                json={"items": [{"product_id": products[sku].id, "quantity": qty}]},
            )
            assert r.status_code == 200, r.text
            if products[sku].stock_qty > 0:
                existing = self.model.get(sku, 0)
                self.model[sku] = max(existing, min(existing + qty, self.limit(sku)))

        @rule()
        def clear(self):
            assert client.delete("/api/v1/cart").status_code == 204
            self.model.clear()

        @invariant()
        def api_matches_model(self):
            body = client.get("/api/v1/cart").json()
            assert {line["sku"]: line["quantity"] for line in body["items"]} == self.model
            assert body["item_count"] == sum(self.model.values())
            assert body["subtotal_cents"] == sum(
                products[s].price_cents * q for s, q in self.model.items()
            )
            assert body["has_issues"] is False  # rules never let a bad line in

    return CartMachine


def test_cart_behaves_like_the_model(cart_machine):
    state_machine_settings = settings(
        max_examples=15,
        stateful_step_count=12,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
    )
    cart_machine.TestCase.settings = state_machine_settings
    cart_machine.TestCase().runTest()
