"""CHK-01..08 and ORD-01..03 end to end through the API (real Postgres)."""

import pytest
from sqlalchemy import func, select

from app.models import InventoryMovement, Order, Payment
from app.services.payments import DECLINED_CARD, INSUFFICIENT_FUNDS_CARD, SUCCESS_CARD
from tests.helpers import VALID_ADDRESS, error_code, refresh_session, travel
from tests.integration.checkout_support import (
    PLACE,
    QUOTE,
    add,
    key,
    pay,
    place,
    quote,
    stock,
)


class TestQuote:
    def test_texas_quote(self, client, address, products):
        add(client, products["KIT-001"], 2)  # 2 x 24.99
        q = quote(client, address)
        assert (q["subtotal_cents"], q["tax_cents"], q["shipping_cents"], q["total_cents"]) == (
            4998,
            412,
            599,
            6009,
        )
        assert (q["tax_state"], q["tax_rate"]) == ("TX", 0.0825)
        assert {o["method"]: o["cents"] for o in q["shipping_options"]} == {
            "standard": 599,
            "express": 1499,
        }
        assert q["can_place_order"] is True

    def test_oregon_has_no_sales_tax(self, client, customer, products):
        oregon = client.post(
            "/api/v1/me/addresses",
            json={**VALID_ADDRESS, "state": "OR", "city": "Portland", "postal_code": "97201"},
        ).json()
        add(client, products["KIT-001"], 2)
        assert quote(client, oregon)["tax_cents"] == 0

    @pytest.mark.parametrize(
        ("sku", "shipping"), [("KIT-006", 599), ("KIT-007", 0)]
    )  # 49.99 / 50.00
    def test_free_shipping_boundary(self, client, address, products, sku, shipping):
        add(client, products[sku])
        assert quote(client, address)["shipping_cents"] == shipping

    def test_express(self, client, address, products):
        add(client, products["KIT-007"])  # $50 - standard would be free
        assert quote(client, address, "express")["shipping_cents"] == 1499

    def test_empty_cart_cannot_order(self, client, address):
        q = quote(client, address)
        assert (q["can_place_order"], q["blocking_reason"]) == (False, "Your cart is empty.")

    def test_someone_elses_address_is_404(self, client, customer, make_user, db):
        from tests.factories import AddressFactory

        other, _ = make_user()
        AddressFactory._meta.sqlalchemy_session = db
        theirs = AddressFactory(user_id=other.id)
        response = client.post(QUOTE, json={"address_id": theirs.id})
        assert response.status_code == 404


class TestPlaceOrder:
    def test_creates_pending_order_with_snapshots(self, client, db, address, products):
        add(client, products["KIT-001"], 2)
        before = stock(db, products["KIT-001"])
        response = place(client, address)

        assert response.status_code == 201
        order = response.json()
        assert order["status"] == "pending_payment"
        assert order["order_number"].startswith("HB-") and len(order["order_number"]) == 11
        assert order["total_cents"] == 6009
        assert order["items"] == [
            {
                "product_id": products["KIT-001"].id,
                "sku": "KIT-001",
                "product_name": "Nonstick Frying Pan 10in",
                "unit_price_cents": 2499,
                "quantity": 2,
                "line_total_cents": 4998,
            }
        ]
        assert order["ship_to"]["city"] == "Austin"
        assert order["can_pay"] and order["can_cancel"]
        assert [h["to_status"] for h in order["history"]] == ["pending_payment"]

        # ORD-01: stock taken, with a ledger row; cart emptied.
        assert stock(db, products["KIT-001"]) == before - 2
        movement = db.scalar(
            select(InventoryMovement).where(InventoryMovement.order_id.is_not(None))
        )
        assert (movement.delta, movement.reason) == (-2, "order_placed")
        assert client.get("/api/v1/cart").json()["items"] == []

    def test_snapshot_survives_later_price_and_address_changes(self, client, db, address, products):
        """CHK-06"""
        add(client, products["KIT-001"])
        number = place(client, address).json()["order_number"]
        products["KIT-001"].price_cents = 9999
        products["KIT-001"].name = "Renamed Pan"
        client.patch(f"/api/v1/me/addresses/{address['id']}", json={"city": "Houston"})
        db.flush()

        order = client.get(f"/api/v1/orders/{number}").json()
        assert order["items"][0]["unit_price_cents"] == 2499
        assert order["items"][0]["product_name"] == "Nonstick Frying Pan 10in"
        assert order["ship_to"]["city"] == "Austin"

    def test_payment_window_is_thirty_minutes(self, client, address, products):
        add(client, products["KIT-001"])
        order = place(client, address).json()
        from datetime import datetime

        placed = datetime.fromisoformat(order["placed_at"])
        expires = datetime.fromisoformat(order["payment_expires_at"])
        assert (expires - placed).total_seconds() == 30 * 60

    def test_empty_cart(self, client, address):
        response = place(client, address, expected=0)
        assert (response.status_code, error_code(response)) == (409, "cart_empty")

    def test_total_changed_since_the_quote(self, client, db, address, products):
        add(client, products["KIT-001"])
        seen = quote(client, address)["total_cents"]
        products["KIT-001"].price_cents = 2799
        db.flush()
        response = place(client, address, expected=seen)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "total_changed"
        assert response.json()["error"]["current_total_cents"] != seen
        assert db.scalar(select(func.count()).select_from(Order)) == 0

    def test_stock_changed_since_adding_lists_every_problem_line(
        self, client, db, address, products
    ):
        """CHK-04: per-line messages."""
        add(client, products["KIT-001"], 4)
        add(client, products["CLN-001"], 1)
        add(client, products["KIT-002"], 1)
        products["KIT-001"].stock_qty = 2
        products["CLN-001"].stock_qty = 0
        db.flush()
        response = place(client, address, expected=1)
        assert response.status_code == 409
        body = response.json()["error"]
        assert body["code"] == "cart_has_issues"
        assert {(x["sku"], x["issue"], x["requested"], x["available"]) for x in body["lines"]} == {
            ("KIT-001", "insufficient_stock", 4, 2),
            ("CLN-001", "out_of_stock", 1, 0),
        }

    def test_idempotent_replay_returns_the_same_order(self, client, db, address, products):
        """CHK-08: a double-submitted Place Order creates exactly one order."""
        add(client, products["KIT-001"], 2)
        total = quote(client, address)["total_cents"]
        idem = key()
        first = place(client, address, idem=idem, expected=total)
        second = place(client, address, idem=idem, expected=total)

        assert (first.status_code, second.status_code) == (201, 200)
        assert second.headers["Idempotent-Replayed"] == "true"
        assert first.json()["order_number"] == second.json()["order_number"]
        assert db.scalar(select(func.count()).select_from(Order)) == 1
        assert stock(db, products["KIT-001"]) == 38  # 40 - 2, taken once

    def test_same_key_different_request_is_refused(self, client, address, products):
        add(client, products["KIT-001"])
        idem = key()
        place(client, address, idem=idem)
        response = place(client, address, "express", idem=idem, expected=1)
        assert (response.status_code, error_code(response)) == (422, "idempotency_key_reused")

    @pytest.mark.parametrize("bad", [None, "short", "has spaces in it", "x" * 49, "semi;colon!"])
    def test_idempotency_key_is_required_and_validated(self, client, address, products, bad):
        add(client, products["KIT-001"])
        headers = {} if bad is None else {"Idempotency-Key": bad}
        response = client.post(
            PLACE,
            json={"address_id": address["id"], "expected_total_cents": 1},
            headers=headers,
        )
        assert response.status_code == 422

    def test_requires_sign_in(self, client):
        assert client.post(PLACE, json={}, headers={"Idempotency-Key": key()}).status_code == 401


class TestPay:
    def test_success(self, client, db, pending):
        response = pay(client, pending["order_number"])
        assert response.status_code == 200
        order = response.json()
        assert order["status"] == "paid"
        assert order["can_pay"] is False
        assert order["payments"][0] == {
            **order["payments"][0],
            "status": "succeeded",
            "amount_cents": 6009,
            "card_last4": "4242",
        }
        assert [h["to_status"] for h in order["history"]] == ["pending_payment", "paid"]

    def test_card_number_is_never_stored_or_returned(self, client, db, pending):
        response = pay(client, pending["order_number"])
        assert SUCCESS_CARD not in response.text
        payment = db.scalar(select(Payment))
        assert SUCCESS_CARD not in " ".join(str(v) for v in vars(payment).values())

    @pytest.mark.parametrize(
        ("card", "code"),
        [
            (DECLINED_CARD, "card_declined"),
            (INSUFFICIENT_FUNDS_CARD, "insufficient_funds"),
            ("5555555555554444", "test_cards_only"),
        ],
    )
    def test_declines_keep_the_order_payable(self, client, pending, card, code):
        response = pay(client, pending["order_number"], card)
        assert response.status_code == 402
        assert response.json()["error"]["code"] == code
        assert response.json()["error"]["can_retry"] is True
        order = client.get(f"/api/v1/orders/{pending['order_number']}").json()
        assert order["status"] == "pending_payment" and order["can_pay"] is True
        assert order["payments"][0]["status"] == "declined"

    def test_decline_then_retry_with_a_new_key_succeeds(self, client, pending):
        assert pay(client, pending["order_number"], DECLINED_CARD).status_code == 402
        assert pay(client, pending["order_number"]).status_code == 200

    def test_replay_never_charges_twice(self, client, db, pending):
        idem = key()
        first = pay(client, pending["order_number"], idem=idem)
        second = pay(client, pending["order_number"], idem=idem)
        assert (first.status_code, second.status_code) == (200, 200)
        assert second.headers["Idempotent-Replayed"] == "true"
        assert db.scalar(select(func.count()).select_from(Payment)) == 1

    def test_replayed_decline_is_still_a_decline(self, client, db, pending):
        idem = key()
        assert pay(client, pending["order_number"], DECLINED_CARD, idem=idem).status_code == 402
        again = pay(client, pending["order_number"], DECLINED_CARD, idem=idem)
        assert again.status_code == 402 and again.headers["Idempotent-Replayed"] == "true"
        assert db.scalar(select(func.count()).select_from(Payment)) == 1

    def test_key_reused_with_a_different_card(self, client, pending):
        idem = key()
        pay(client, pending["order_number"], DECLINED_CARD, idem=idem)
        response = pay(client, pending["order_number"], idem=idem)  # now the success card
        assert error_code(response) == "idempotency_key_reused"

    def test_paying_twice_with_new_keys(self, client, pending):
        assert pay(client, pending["order_number"]).status_code == 200
        response = pay(client, pending["order_number"])
        assert (response.status_code, error_code(response)) == (409, "order_already_paid")

    @pytest.mark.parametrize(
        ("field", "value", "code"),
        [
            ("card_number", "4242424242424241", "invalid_card_number"),  # fails Luhn
            ("exp_year", 2020, "card_expired"),
        ],
    )
    def test_card_checks(self, client, pending, field, value, code):
        response = pay(client, pending["order_number"], **{field: value})
        assert (response.status_code, error_code(response)) == (422, code)

    @pytest.mark.parametrize(
        "overrides",
        [
            {"cvc": "12"},
            {"cvc": "abcd"},
            {"exp_month": 13},
            {"card_number": "4242-abcd"},
            {"name_on_card": ""},
        ],
    )
    def test_malformed_card_details(self, client, pending, overrides):
        assert pay(client, pending["order_number"], **overrides).status_code == 422

    def test_card_expiring_this_month_still_works(self, client, pending):
        from app.core import clock

        now = clock.now()
        response = pay(client, pending["order_number"], exp_month=now.month, exp_year=now.year)
        assert response.status_code == 200

    def test_other_customers_order_is_404(self, client, pending, make_user, auth_as):
        other, pw = make_user()
        auth_as(other.email, pw)
        assert pay(client, pending["order_number"]).status_code == 404
        assert client.get(f"/api/v1/orders/{pending['order_number']}").status_code == 404


class TestExpiry:
    """ORD-01: unpaid orders expire after 30 minutes and give their stock back."""

    def test_valid_until_just_before_thirty_minutes(self, frozen_clock, client, pending):
        travel(minutes=29, seconds=59)
        refresh_session(client)
        assert pay(client, pending["order_number"]).status_code == 200

    def test_expired_at_thirty_minutes_and_restocked(
        self, frozen_clock, client, db, pending, products
    ):
        before = stock(db, products["KIT-001"])
        travel(minutes=30)
        refresh_session(client)
        response = pay(client, pending["order_number"])
        assert (response.status_code, error_code(response)) == (409, "order_expired")

        order = client.get(f"/api/v1/orders/{pending['order_number']}").json()
        assert order["status"] == "expired"
        assert (order["can_pay"], order["can_cancel"]) == (False, False)
        assert stock(db, products["KIT-001"]) == before + 2
        reasons = db.scalars(
            select(InventoryMovement.reason).where(InventoryMovement.order_id.is_not(None))
        ).all()
        assert sorted(reasons) == ["order_expired", "order_placed"]

    def test_sweep_expires_without_anyone_visiting_the_order(self, client, db, pending, products):
        travel(minutes=31)
        assert client.post("/api/v1/test/expire-orders").json() == {"expired": 1}
        assert client.post("/api/v1/test/expire-orders").json() == {"expired": 0}  # idempotent

    def test_expired_stock_is_available_to_the_next_shopper(
        self, client, db, customer, products, make_user, auth_as
    ):
        client.post("/api/v1/me/addresses", json=VALID_ADDRESS)
        add(client, products["CLN-005"], 1)  # the last glass cleaner
        addr = client.get("/api/v1/me/addresses").json()[0]
        place(client, addr)
        assert stock(db, products["CLN-005"]) == 0

        travel(minutes=31)
        other, pw = make_user()
        auth_as(other.email, pw)
        theirs = client.post("/api/v1/me/addresses", json=VALID_ADDRESS).json()
        add(client, products["CLN-005"], 1)  # checkout sweeps first, so the unit is back
        assert place(client, theirs).status_code == 201


class TestCancel:
    def test_cancel_unpaid_restocks(self, client, db, pending, products):
        before = stock(db, products["KIT-001"])
        response = client.post(f"/api/v1/orders/{pending['order_number']}/cancel")
        assert response.json()["status"] == "cancelled"
        assert stock(db, products["KIT-001"]) == before + 2
        assert response.json()["payments"] == []

    def test_cancel_paid_order_refunds(self, client, pending):
        pay(client, pending["order_number"])
        order = client.post(f"/api/v1/orders/{pending['order_number']}/cancel").json()
        assert order["status"] == "cancelled"
        assert [(p["status"], p["amount_cents"]) for p in order["payments"]] == [
            ("succeeded", 6009),
            ("refunded", 6009),
        ]
        assert order["history"][-1]["note"] == "Cancelled by customer; payment refunded"

    @pytest.mark.parametrize("path", [["processing"], ["processing", "shipped"]])
    def test_cancel_until_shipped(self, client, pending, path, admin_headers):
        pay(client, pending["order_number"])
        for status in path:
            client.post(
                f"/api/v1/admin/orders/{pending['order_number']}/status",
                json={"to": status},
                headers=admin_headers,
            )
        response = client.post(f"/api/v1/orders/{pending['order_number']}/cancel")
        if path[-1] == "shipped":
            assert (response.status_code, error_code(response)) == (409, "invalid_transition")
        else:
            assert response.json()["status"] == "cancelled"

    def test_cannot_cancel_twice(self, client, pending):
        client.post(f"/api/v1/orders/{pending['order_number']}/cancel")
        response = client.post(f"/api/v1/orders/{pending['order_number']}/cancel")
        assert error_code(response) == "invalid_transition"

    def test_cancelled_order_cannot_be_paid(self, client, pending):
        client.post(f"/api/v1/orders/{pending['order_number']}/cancel")
        response = pay(client, pending["order_number"])
        assert (response.status_code, error_code(response)) == (409, "order_not_payable")


class TestLifecycleAndHistory:
    def test_full_happy_path_is_audited(self, client, pending, admin_headers):
        """ORD-03: every transition recorded in order."""
        number = pending["order_number"]
        pay(client, number)
        for status in ("processing", "shipped", "delivered"):
            response = client.post(
                f"/api/v1/admin/orders/{number}/status", json={"to": status}, headers=admin_headers
            )
            assert response.status_code == 200, response.text
        refund = client.post(
            f"/api/v1/admin/orders/{number}/refund", json={}, headers=admin_headers
        )
        assert refund.status_code == 200
        history = client.get(f"/api/v1/orders/{number}").json()["history"]
        assert [(h["from_status"], h["to_status"]) for h in history] == [
            (None, "pending_payment"),
            ("pending_payment", "paid"),
            ("paid", "processing"),
            ("processing", "shipped"),
            ("shipped", "delivered"),
            ("delivered", "refunded"),
        ]

    @pytest.mark.parametrize("target", ["processing", "shipped", "delivered"])
    def test_skipping_ahead_of_payment_is_409(self, client, pending, target, admin_headers):
        """ORD-02: an unpaid order can't be fulfilled, even by an admin."""
        response = client.post(
            f"/api/v1/admin/orders/{pending['order_number']}/status",
            json={"to": target},
            headers=admin_headers,
        )
        assert (response.status_code, error_code(response)) == (409, "invalid_transition")

    def test_refund_before_delivery_is_409(self, client, pending, admin_headers):
        response = client.post(
            f"/api/v1/admin/orders/{pending['order_number']}/refund", json={}, headers=admin_headers
        )
        assert (response.status_code, error_code(response)) == (409, "invalid_transition")


class TestOrderList:
    def test_newest_first_with_counts(self, client, address, products):
        add(client, products["KIT-001"], 2)
        first = place(client, address).json()["order_number"]
        add(client, products["CLN-001"], 3)
        second = place(client, address).json()["order_number"]

        body = client.get("/api/v1/orders").json()
        assert body["total"] == 2
        assert [(o["order_number"], o["item_count"]) for o in body["items"]] == [
            (second, 3),
            (first, 2),
        ]

    def test_only_my_orders(self, client, pending, make_user, auth_as):
        other, pw = make_user()
        auth_as(other.email, pw)
        assert client.get("/api/v1/orders").json() == {
            "items": [],
            "total": 0,
            "page": 1,
            "page_size": 10,
        }
