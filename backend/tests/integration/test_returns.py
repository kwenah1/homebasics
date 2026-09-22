"""RET-01..06: the 30-day window, returnable quantities, the return state machine, refunds of
the paid share, restocking, and how returns interact with a full refund (ADM-07)."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models import InventoryMovement, InventoryReason, Order, Payment, PaymentStatus
from tests.factories import DEFAULT_PASSWORD
from tests.helpers import error_code, travel
from tests.integration.checkout_support import add, deliver, pay, place, place_with, stock

ADMIN = "/api/v1/admin/returns"


def order_url(number: str) -> str:
    return f"/api/v1/orders/{number}"


def request_return(client, number, items, reason="no_longer_needed", note=None):
    body = {"items": items, "reason": reason}
    if note is not None:
        body["note"] = note
    return client.post(f"{order_url(number)}/returns", json=body)


def admin_action(client, admin_headers, rn, action, **body):
    return client.post(f"{ADMIN}/{rn}/{action}", json=body, headers=admin_headers)


def refunds(db, number) -> list[int]:
    order = db.scalar(select(Order).where(Order.order_number == number))
    return list(
        db.scalars(
            select(Payment.amount_cents)
            .where(Payment.order_id == order.id, Payment.status == PaymentStatus.REFUNDED)
            .order_by(Payment.id)
        )
    )


@pytest.fixture
def delivered(frozen_clock, client, address, products, admin_headers):
    """A delivered order: 2 x KIT-001 ($24.99) + 1 x CLN-001 ($4.99), shipped standard.
    Subtotal $54.97 (free shipping), TX tax 8.25% = $4.54, total $59.51."""
    add(client, products["KIT-001"], 2)
    add(client, products["CLN-001"])
    number = place(client, address).json()["order_number"]
    deliver(client, number, admin_headers)
    return client.get(order_url(number)).json()


def pan(products):
    return products["KIT-001"].id


def spray(products):
    return products["CLN-001"].id


class TestWindow:
    def test_delivered_order_offers_returns_for_30_days(self, client, delivered, products):
        window = delivered["return_window"]
        assert window["can_return"] is True
        returnable = {r["sku"]: r["quantity"] for r in window["returnable"]}
        assert returnable == {"KIT-001": 2, "CLN-001": 1}
        assert datetime.fromisoformat(window["return_by"]) - datetime.fromisoformat(
            delivered["delivered_at"]
        ) == timedelta(days=30)

    def test_undelivered_order_cannot_be_returned(self, client, address, products):
        add(client, products["KIT-001"])
        order = place(client, address).json()
        assert pay(client, order["order_number"]).status_code == 200
        assert order["return_window"] == {"can_return": False, "return_by": None, "returnable": []}
        r = request_return(
            client, order["order_number"], [{"product_id": pan(products), "quantity": 1}]
        )
        assert (r.status_code, error_code(r)) == (409, "return_window_closed")

    def test_last_second_of_the_window(self, client, delivered, products, customer, auth_as):
        travel(days=30, seconds=-1)
        auth_as(customer.email, DEFAULT_PASSWORD)  # a month outlives the 7-day session
        line = [{"product_id": pan(products), "quantity": 1}]
        assert request_return(client, delivered["order_number"], line).status_code == 201

    def test_closed_at_exactly_30_days(self, client, delivered, products, customer, auth_as):
        travel(days=30)
        auth_as(customer.email, DEFAULT_PASSWORD)
        order = client.get(order_url(delivered["order_number"])).json()
        assert order["return_window"]["can_return"] is False
        r = request_return(
            client, delivered["order_number"], [{"product_id": pan(products), "quantity": 1}]
        )
        assert (r.status_code, error_code(r)) == (409, "return_window_closed")

    def test_someone_elses_order_is_404(self, client, delivered, products, make_user, auth_as):
        other, password = make_user()
        auth_as(other.email, password)
        r = request_return(
            client, delivered["order_number"], [{"product_id": pan(products), "quantity": 1}]
        )
        assert r.status_code == 404


class TestRequesting:
    def test_partial_return(self, client, delivered, products):
        r = request_return(
            client,
            delivered["order_number"],
            [{"product_id": pan(products), "quantity": 1}],
            reason="damaged",
            note=" Handle snapped ",
        )
        assert r.status_code == 201, r.text
        ret = r.json()
        assert (ret["status"], ret["reason"], ret["note"], ret["value_cents"]) == (
            "requested",
            "damaged",
            "Handle snapped",
            2499,
        )
        assert ret["return_number"].startswith("RT-")
        assert (ret["refund_cents"], ret["can_cancel"]) == (None, True)
        left = client.get(order_url(delivered["order_number"])).json()["return_window"]
        assert {r["sku"]: r["quantity"] for r in left["returnable"]} == {"KIT-001": 1, "CLN-001": 1}

    def test_cannot_return_more_than_remains(self, client, delivered, products):
        number = delivered["order_number"]
        assert (
            request_return(
                client, number, [{"product_id": pan(products), "quantity": 2}]
            ).status_code
            == 201
        )
        r = request_return(client, number, [{"product_id": pan(products), "quantity": 1}])
        assert (r.status_code, error_code(r)) == (422, "return_quantity_invalid")
        assert r.json()["error"]["lines"] == {str(pan(products)): "Only 0 can still be returned."}

    def test_product_not_on_the_order(self, client, delivered, products):
        r = request_return(
            client,
            delivered["order_number"],
            [{"product_id": products["BTH-001"].id, "quantity": 1}],
        )
        assert (r.status_code, error_code(r)) == (422, "return_quantity_invalid")

    @pytest.mark.parametrize(
        "body",
        [
            {"items": [], "reason": "damaged"},
            {"items": [{"product_id": 1, "quantity": 0}], "reason": "damaged"},
            {"items": [{"product_id": 1, "quantity": 1}], "reason": "bored"},
            {
                "items": [{"product_id": 1, "quantity": 1}, {"product_id": 1, "quantity": 1}],
                "reason": "damaged",
            },
            {"items": [{"product_id": 1, "quantity": 1}], "reason": "other", "note": "x" * 501},
        ],
    )
    def test_invalid_requests_are_422(self, client, delivered, body):
        r = client.post(f"{order_url(delivered['order_number'])}/returns", json=body)
        assert (r.status_code, error_code(r)) == (422, "validation_error")

    def test_my_returns_lists_them(self, client, delivered, products):
        rn = request_return(
            client, delivered["order_number"], [{"product_id": spray(products), "quantity": 1}]
        ).json()["return_number"]
        assert [r["return_number"] for r in client.get("/api/v1/returns").json()] == [rn]
        assert (
            client.get(f"/api/v1/returns/{rn}").json()["order_number"] == delivered["order_number"]
        )
        listed = client.get(f"{order_url(delivered['order_number'])}/returns").json()
        assert [r["return_number"] for r in listed] == [rn]


class TestStateMachine:
    @pytest.fixture
    def rn(self, client, delivered, products):
        return request_return(
            client, delivered["order_number"], [{"product_id": pan(products), "quantity": 1}]
        ).json()["return_number"]

    def test_customer_cancels_and_the_units_come_back(self, client, delivered, rn):
        r = client.post(f"/api/v1/returns/{rn}/cancel")
        assert (r.status_code, r.json()["status"]) == (200, "cancelled")
        left = client.get(order_url(delivered["order_number"])).json()["return_window"]
        assert {r["sku"]: r["quantity"] for r in left["returnable"]}["KIT-001"] == 2
        again = client.post(f"/api/v1/returns/{rn}/cancel")
        assert (again.status_code, error_code(again)) == (409, "invalid_return_transition")

    def test_approve_then_customer_may_still_cancel(self, client, rn, admin_headers):
        r = admin_action(client, admin_headers, rn, "approve", note="Label emailed")
        assert (r.json()["status"], r.json()["staff_note"]) == ("approved", "Label emailed")
        assert client.post(f"/api/v1/returns/{rn}/cancel").status_code == 200

    def test_reject_needs_a_reason_and_frees_the_units(self, client, delivered, rn, admin_headers):
        assert admin_action(client, admin_headers, rn, "reject").status_code == 422
        assert admin_action(client, admin_headers, rn, "reject", note="  ").status_code == 422
        r = admin_action(client, admin_headers, rn, "reject", note="Outside policy")
        assert (r.json()["status"], r.json()["can_cancel"]) == ("rejected", False)
        left = client.get(order_url(delivered["order_number"])).json()["return_window"]
        assert {r["sku"]: r["quantity"] for r in left["returnable"]}["KIT-001"] == 2

    def test_cannot_receive_before_approval(self, client, rn, admin_headers):
        r = admin_action(client, admin_headers, rn, "receive", restock=True)
        assert (r.status_code, error_code(r)) == (409, "invalid_return_transition")

    def test_received_is_final(self, client, rn, admin_headers):
        admin_action(client, admin_headers, rn, "approve")
        assert admin_action(client, admin_headers, rn, "receive", restock=True).status_code == 200
        for action, body in [
            ("receive", {"restock": True}),
            ("reject", {"note": "x"}),
            ("approve", {}),
        ]:
            assert admin_action(client, admin_headers, rn, action, **body).status_code == 409
        assert client.post(f"/api/v1/returns/{rn}/cancel").status_code == 409

    def test_customers_cannot_decide_returns(self, client, rn):
        assert client.post(f"{ADMIN}/{rn}/approve", json={}).status_code == 403

    def test_unknown_return_is_404(self, client, admin_headers, customer):
        assert client.get("/api/v1/returns/RT-NOPE0000").status_code == 404
        assert client.get(f"{ADMIN}/RT-NOPE0000", headers=admin_headers).status_code == 404

    def test_admin_filters_by_status(self, client, rn, admin_headers):
        waiting = client.get(ADMIN, params={"status": "requested"}, headers=admin_headers).json()
        assert rn in [r["return_number"] for r in waiting]
        approved = client.get(ADMIN, params={"status": "approved"}, headers=admin_headers).json()
        assert rn not in [r["return_number"] for r in approved]


class TestRefundsAndStock:
    def receive(self, client, admin_headers, number, items, restock=True):
        rn = request_return(client, number, items).json()["return_number"]
        admin_action(client, admin_headers, rn, "approve")
        r = admin_action(client, admin_headers, rn, "receive", restock=restock)
        assert r.status_code == 200, r.text
        return r.json()

    def test_partial_refund_is_the_paid_share(self, client, db, delivered, products, admin_headers):
        """Goods paid = total - shipping = $59.51. One pan is 2499/5497 of it, rounded down."""
        number = delivered["order_number"]
        goods = delivered["total_cents"] - delivered["shipping_cents"]
        ret = self.receive(
            client, admin_headers, number, [{"product_id": pan(products), "quantity": 1}]
        )
        assert ret["refund_cents"] == goods * 2499 // 5497
        assert refunds(db, number) == [ret["refund_cents"]]
        assert client.get(order_url(number)).json()["status"] == "delivered"  # partial

    def test_restock_puts_units_back_with_a_ledger_entry(
        self, client, db, delivered, products, admin_headers
    ):
        before = stock(db, products["KIT-001"])
        self.receive(
            client,
            admin_headers,
            delivered["order_number"],
            [{"product_id": pan(products), "quantity": 2}],
        )
        assert stock(db, products["KIT-001"]) == before + 2
        movement = db.scalar(
            select(InventoryMovement)
            .where(InventoryMovement.reason == InventoryReason.RETURN_RESTOCK)
            .order_by(InventoryMovement.id.desc())
        )
        assert (movement.product_id, movement.delta) == (pan(products), 2)
        ledger = db.scalar(
            select(func.sum(InventoryMovement.delta)).where(
                InventoryMovement.product_id == pan(products)
            )
        )
        assert ledger == stock(db, products["KIT-001"])  # ADM-02a still reconciles

    def test_damaged_goods_are_refunded_but_not_restocked(
        self, client, db, delivered, products, admin_headers
    ):
        before = stock(db, products["KIT-001"])
        ret = self.receive(
            client,
            admin_headers,
            delivered["order_number"],
            [{"product_id": pan(products), "quantity": 1}],
            restock=False,
        )
        assert (ret["restocked"], ret["refund_cents"] > 0) == (False, True)
        assert stock(db, products["KIT-001"]) == before

    def test_returning_everything_refunds_exactly_the_goods_and_closes_the_order(
        self, client, db, delivered, products, admin_headers
    ):
        number = delivered["order_number"]
        self.receive(client, admin_headers, number, [{"product_id": pan(products), "quantity": 1}])
        self.receive(
            client,
            admin_headers,
            number,
            [
                {"product_id": pan(products), "quantity": 1},
                {"product_id": spray(products), "quantity": 1},
            ],
        )
        assert sum(refunds(db, number)) == delivered["total_cents"] - delivered["shipping_cents"]
        order = client.get(order_url(number)).json()
        assert order["status"] == "refunded"
        assert order["history"][-1]["note"] == "All items returned"
        assert order["return_window"]["can_return"] is False

    def test_coupon_discount_is_shared_out(
        self, frozen_clock, client, db, address, products, admin_headers
    ):
        """$49.98 with 10% off: the refund for one of two pans is half of what was paid."""
        add(client, products["KIT-001"], 2)
        order = place_with(client, address, coupon="WELCOME10").json()
        deliver(client, order["order_number"], admin_headers)
        ret = self.receive(
            client,
            admin_headers,
            order["order_number"],
            [{"product_id": pan(products), "quantity": 1}],
        )
        goods = order["total_cents"] - order["shipping_cents"]  # 4998 - 500 + 371
        assert goods == 4869
        assert ret["refund_cents"] == goods // 2 == 2434  # not the $24.99 list price


class TestFullRefundAfterReturns:
    def test_full_refund_is_blocked_while_a_return_is_open(
        self, client, delivered, products, admin_headers
    ):
        number = delivered["order_number"]
        request_return(client, number, [{"product_id": pan(products), "quantity": 1}])
        r = client.post(f"/api/v1/admin/orders/{number}/refund", json={}, headers=admin_headers)
        assert (r.status_code, error_code(r)) == (409, "return_in_progress")

    def test_full_refund_pays_back_only_what_is_left(
        self, client, db, delivered, products, admin_headers
    ):
        number = delivered["order_number"]
        rn = request_return(client, number, [{"product_id": pan(products), "quantity": 1}]).json()[
            "return_number"
        ]
        admin_action(client, admin_headers, rn, "approve")
        admin_action(client, admin_headers, rn, "receive", restock=True)
        r = client.post(f"/api/v1/admin/orders/{number}/refund", json={}, headers=admin_headers)
        assert r.status_code == 200, r.text
        assert sum(refunds(db, number)) == delivered["total_cents"]  # never more than charged
