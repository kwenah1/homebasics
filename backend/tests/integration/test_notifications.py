"""EML-01..03 order and return emails, ALR-01 low-stock alerts - and that they're queued in the
same transaction as the change (nothing is sent for a change that didn't happen)."""

import pytest
from sqlalchemy import select

from app.models import OutboxEmail, User, UserRole
from tests.helpers import error_code, refresh_session, travel
from tests.integration.checkout_support import PLACE, add, deliver, key, pay, place

ADMIN_EMAIL = "admin@homebasics.test"


def subjects(db, to: str) -> list[str]:
    return list(
        db.scalars(
            select(OutboxEmail.subject)
            .where(OutboxEmail.to_address == to.lower())
            .order_by(OutboxEmail.id)
        )
    )


def admin_subjects(db) -> list[str]:
    return [s for s in subjects(db, ADMIN_EMAIL) if s.startswith(("Low stock", "Out of stock"))]


class TestOrderEmails:
    def test_the_whole_journey(self, client, db, customer, address, products, admin_headers):
        add(client, products["KIT-001"])
        order = place(client, address).json()
        n = order["order_number"]
        assert (
            subjects(db, customer.email)[-1] == f"Order {n} received - please pay within 30 minutes"
        )
        deliver(client, n, admin_headers)  # pay -> processing -> shipped -> delivered
        assert subjects(db, customer.email)[-4:] == [
            f"Order {n} received - please pay within 30 minutes",
            f"Payment received for {n}",
            f"Your order {n} has shipped",  # processing sends nothing
            f"Your order {n} was delivered",
        ]

    def test_cancelling_a_paid_order_mentions_the_refund(
        self, client, db, customer, address, products
    ):
        add(client, products["KIT-001"])
        n = place(client, address).json()["order_number"]
        pay(client, n)
        client.post(f"/api/v1/orders/{n}/cancel")
        last = db.scalar(
            select(OutboxEmail)
            .where(OutboxEmail.to_address == customer.email)
            .order_by(OutboxEmail.id.desc())
        )
        assert last.subject == f"Order {n} cancelled"
        assert "refunded" in last.body

    def test_cancelling_an_unpaid_order_does_not(self, client, db, customer, address, products):
        add(client, products["KIT-001"])
        n = place(client, address).json()["order_number"]
        client.post(f"/api/v1/orders/{n}/cancel")
        last = db.scalar(
            select(OutboxEmail)
            .where(OutboxEmail.to_address == customer.email)
            .order_by(OutboxEmail.id.desc())
        )
        assert "refunded" not in last.body

    def test_expiry(self, frozen_clock, client, db, customer, address, products):
        add(client, products["KIT-001"])
        n = place(client, address).json()["order_number"]
        travel(minutes=30)
        refresh_session(client)
        client.get(f"/api/v1/orders/{n}")  # any request runs the sweep
        assert subjects(db, customer.email)[-1] == f"Order {n} expired"

    def test_a_refused_placement_sends_nothing(self, client, db, customer, address, products):
        add(client, products["KIT-001"])
        before = len(subjects(db, customer.email))
        r = client.post(
            PLACE,
            json={"address_id": address["id"], "expected_total_cents": 1},
            headers={"Idempotency-Key": key()},
        )
        assert error_code(r) == "total_changed"
        assert len(subjects(db, customer.email)) == before


class TestReturnEmails:
    def test_each_step_is_emailed(self, client, db, customer, address, products, admin_headers):
        add(client, products["KIT-001"])
        n = place(client, address).json()["order_number"]
        deliver(client, n, admin_headers)
        rn = client.post(
            f"/api/v1/orders/{n}/returns",
            json={
                "items": [{"product_id": products["KIT-001"].id, "quantity": 1}],
                "reason": "damaged",
            },
        ).json()["return_number"]
        client.post(f"/api/v1/admin/returns/{rn}/approve", json={}, headers=admin_headers)
        client.post(
            f"/api/v1/admin/returns/{rn}/receive", json={"restock": False}, headers=admin_headers
        )
        assert [s for s in subjects(db, customer.email) if s.startswith("Return")] == [
            f"Return {rn}: requested",
            f"Return {rn}: approved",
            f"Return {rn}: received",
        ]
        received = db.scalar(
            select(OutboxEmail).where(OutboxEmail.subject == f"Return {rn}: received")
        )
        assert "$" in received.body  # the refund amount

    def test_rejection_tells_the_shopper_why(
        self, client, db, customer, address, products, admin_headers
    ):
        add(client, products["KIT-001"])
        n = place(client, address).json()["order_number"]
        deliver(client, n, admin_headers)
        rn = client.post(
            f"/api/v1/orders/{n}/returns",
            json={
                "items": [{"product_id": products["KIT-001"].id, "quantity": 1}],
                "reason": "other",
            },
        ).json()["return_number"]
        client.post(
            f"/api/v1/admin/returns/{rn}/reject",
            json={"note": "Item was used"},
            headers=admin_headers,
        )
        email = db.scalar(
            select(OutboxEmail).where(OutboxEmail.subject == f"Return {rn}: rejected")
        )
        assert "Item was used" in email.body


class TestLowStockAlerts:
    """CLN-008 starts at 6 - one above the low-stock threshold of 5."""

    @pytest.fixture
    def towel(self, products):
        return products["CLN-008"]

    def buy(self, client, address, product, qty=1):
        add(client, product, qty)
        assert place(client, address).status_code == 201

    def test_alert_when_stock_crosses_into_low(self, client, db, address, towel):
        self.buy(client, address, towel)  # 6 -> 5
        assert admin_subjects(db) == [f"Low stock: CLN-008 {towel.name} (5 left)"]

    def test_only_once_per_crossing(self, client, db, address, towel):
        self.buy(client, address, towel)  # 6 -> 5: alert
        self.buy(client, address, towel)  # 5 -> 4: still low, no new alert
        assert len(admin_subjects(db)) == 1

    def test_out_of_stock_is_its_own_alert(self, client, db, address, towel):
        self.buy(client, address, towel, 6)  # 6 -> 0 in one go
        assert admin_subjects(db) == [f"Out of stock: CLN-008 {towel.name}"]

    def test_every_admin_is_told(self, client, db, address, towel, make_user):
        second, _ = make_user(role=UserRole.ADMIN)
        self.buy(client, address, towel)
        assert subjects(db, second.email) == [f"Low stock: CLN-008 {towel.name} (5 left)"]

    def test_staff_adjustments_alert_too(self, client, db, towel, admin_headers):
        r = client.post(
            f"/api/v1/admin/products/{towel.id}/stock-adjustments",
            json={"delta": -6, "reason": "damaged"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert admin_subjects(db) == [f"Out of stock: CLN-008 {towel.name}"]

    def test_restock_then_sell_down_alerts_again(self, client, db, address, towel, admin_headers):
        self.buy(client, address, towel)  # 6 -> 5: alert
        client.post(
            f"/api/v1/admin/products/{towel.id}/stock-adjustments",
            json={"delta": 10, "reason": "restock"},
            headers=admin_headers,
        )  # 15
        self.buy(client, address, towel, 10)  # 15 -> 5: crosses again
        assert len(admin_subjects(db)) == 2

    def test_customers_never_get_staff_alerts(self, client, db, customer, address, towel):
        self.buy(client, address, towel)
        assert not [s for s in subjects(db, customer.email) if "stock" in s.lower()]
        assert db.scalar(select(User).where(User.email == ADMIN_EMAIL)).role == UserRole.ADMIN
