"""CPN-01..06 through the API: applying codes, every rejection reason, redemptions and limits,
and the admin screens (ADM-05)."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core import clock
from app.models import CouponRedemption, Order
from tests.helpers import error_code, refresh_session, travel
from tests.integration.checkout_support import (
    PLACE,
    QUOTE,
    add,
    deliver,
    key,
    pay,
    place_with,
)

ADMIN_COUPONS = "/api/v1/admin/coupons"


def quote_with(client, address, code, method="standard"):
    return client.post(
        QUOTE,
        json={"address_id": address["id"], "shipping_method": method, "coupon_code": code},
    )


def rejection(response) -> str:
    assert response.status_code == 422, response.text
    assert error_code(response) == "coupon_rejected"
    assert "coupon_code" in response.json()["error"]["fields"]
    return response.json()["error"]["reason"]


@pytest.fixture
def make_coupon(client, admin_headers):
    def _make(code, **fields):
        body = {"code": code, "kind": "percent", "percent_off": 10, **fields}
        r = client.post(ADMIN_COUPONS, json=body, headers=admin_headers)
        assert r.status_code == 201, r.text
        return r.json()

    return _make


class TestApplying:
    def test_percent_coupon_on_the_quote(self, client, address, products):
        add(client, products["KIT-001"], 2)  # $49.98
        q = quote_with(client, address, "WELCOME10").json()
        assert q["coupon"] == {
            "code": "WELCOME10",
            "description": "10% off your first order",
            "discount_cents": 500,  # 499.8 -> 500
        }
        # 4998 - 500 = 4498; tax 8.25% of 4498 = 371.085 -> 371; under $50 so shipping 599
        assert (q["discount_cents"], q["tax_cents"], q["shipping_cents"], q["total_cents"]) == (
            500,
            371,
            599,
            5468,
        )

    def test_code_is_case_insensitive_and_trimmed(self, client, address, products):
        add(client, products["KIT-001"])
        assert quote_with(client, address, "  welcome10 ").json()["coupon"]["code"] == "WELCOME10"

    def test_discount_can_lose_free_shipping(self, client, address, products):
        """CHK-03 compares the *discounted* subtotal: $54.98 - $5 = $49.98 < $50."""
        add(client, products["KIT-001"], 2)
        add(client, products["CLN-001"])  # + $4.99 -> $54.97
        without = client.post(QUOTE, json={"address_id": address["id"]}).json()
        assert without["shipping_cents"] == 0
        assert quote_with(client, address, "SAVE5").json()["shipping_cents"] == 599

    def test_shipping_options_reflect_the_discount(self, client, address, products):
        add(client, products["KIT-001"], 2)
        add(client, products["CLN-001"])
        options = quote_with(client, address, "SAVE5").json()["shipping_options"]
        assert {o["method"]: o["cents"] for o in options}["standard"] == 599

    def test_no_code_no_coupon(self, client, address, products):
        add(client, products["KIT-001"])
        q = client.post(QUOTE, json={"address_id": address["id"]}).json()
        assert (q["coupon"], q["discount_cents"]) == (None, 0)

    @pytest.mark.parametrize("bad", ["ab", "x" * 21, "SAVE 5", "SAVE_5", "ÄBC"])
    def test_malformed_code_is_a_validation_error(self, client, address, bad):
        r = quote_with(client, address, bad)
        assert r.status_code == 422
        assert error_code(r) == "validation_error"


class TestRejections:
    def test_unknown(self, client, address, products):
        add(client, products["KIT-001"])
        assert rejection(quote_with(client, address, "NOPE")) == "invalid"

    def test_disabled_looks_the_same_as_unknown(self, client, address, products, make_coupon):
        make_coupon("OFFNOW", is_active=False)
        add(client, products["KIT-001"])
        assert rejection(quote_with(client, address, "OFFNOW")) == "invalid"

    def test_expired(self, client, address, products):
        add(client, products["KIT-001"])
        assert rejection(quote_with(client, address, "SPRING25")) == "expired"

    def test_min_spend_says_how_far_short(self, client, address, products):
        add(client, products["CLN-001"])  # $4.99 < $30
        r = quote_with(client, address, "SAVE5")
        assert rejection(r) == "min_spend"
        assert r.json()["error"]["min_subtotal_cents"] == 3000
        assert r.json()["error"]["short_by_cents"] == 3000 - 499

    def test_min_spend_boundary_is_inclusive(self, client, address, products, make_coupon):
        make_coupon("EXACT", min_subtotal_cents=2499)
        add(client, products["KIT-001"])  # exactly $24.99
        assert quote_with(client, address, "EXACT").status_code == 200

    def test_already_used(self, client, address, products):
        add(client, products["KIT-001"])
        assert place_with(client, address, coupon="WELCOME10").status_code == 201
        add(client, products["KIT-001"])
        assert rejection(quote_with(client, address, "WELCOME10")) == "already_used"

    def test_exhausted(self, client, address, products, make_coupon, make_user, auth_as):
        make_coupon("ONLYONE", max_redemptions=1)
        add(client, products["KIT-001"])
        assert place_with(client, address, coupon="ONLYONE").status_code == 201

        other, password = make_user()
        auth_as(other.email, password)
        mine = client.post("/api/v1/me/addresses", json=_address()).json()
        add(client, products["KIT-001"])
        assert rejection(quote_with(client, mine, "ONLYONE")) == "exhausted"


class TestTimeWindow:
    def test_not_started_then_active_then_expired(
        self, frozen_clock, client, address, products, make_coupon
    ):
        now = clock.now()
        make_coupon(
            "WINDOW",
            starts_at=(now + timedelta(hours=1)).isoformat(),
            expires_at=(now + timedelta(hours=2)).isoformat(),
            per_user_limit=5,
        )
        add(client, products["KIT-001"])
        assert rejection(quote_with(client, address, "WINDOW")) == "not_started"
        travel(hours=1)  # exactly the start: valid
        refresh_session(client)  # the 15-minute access token expired on the way
        assert quote_with(client, address, "WINDOW").status_code == 200
        travel(minutes=59, seconds=59)
        refresh_session(client)
        assert quote_with(client, address, "WINDOW").status_code == 200
        travel(seconds=1)  # exactly the expiry: gone
        refresh_session(client)
        assert rejection(quote_with(client, address, "WINDOW")) == "expired"


class TestRedemption:
    def test_order_records_the_coupon_and_discount(self, client, db, address, products):
        add(client, products["KIT-001"], 2)
        r = place_with(client, address, coupon="WELCOME10")
        assert r.status_code == 201, r.text
        order = r.json()
        assert (order["coupon_code"], order["discount_cents"], order["total_cents"]) == (
            "WELCOME10",
            500,
            5468,
        )
        stored = db.scalar(select(Order).where(Order.order_number == order["order_number"]))
        assert db.scalar(select(CouponRedemption).where(CouponRedemption.order_id == stored.id))

    def test_payment_charges_the_discounted_total(self, client, address, products):
        add(client, products["KIT-001"], 2)
        order = place_with(client, address, coupon="WELCOME10").json()
        paid = pay(client, order["order_number"]).json()
        assert paid["payments"][-1]["amount_cents"] == 5468

    def test_cancelling_gives_the_use_back(self, client, address, products):
        add(client, products["KIT-001"])
        order = place_with(client, address, coupon="WELCOME10").json()
        assert client.post(f"/api/v1/orders/{order['order_number']}/cancel").status_code == 200
        add(client, products["KIT-001"])
        assert quote_with(client, address, "WELCOME10").status_code == 200

    def test_expiry_gives_the_use_back(self, frozen_clock, client, address, products):
        add(client, products["KIT-001"])
        assert place_with(client, address, coupon="WELCOME10").status_code == 201
        travel(minutes=30)  # payment window closes; the sweep expires the order
        refresh_session(client)
        add(client, products["KIT-001"])
        assert quote_with(client, address, "WELCOME10").status_code == 200

    def test_a_delivered_order_keeps_its_use(self, client, address, products, admin_headers):
        add(client, products["KIT-001"])
        order = place_with(client, address, coupon="WELCOME10").json()
        deliver(client, order["order_number"], admin_headers)
        add(client, products["KIT-001"])
        assert rejection(quote_with(client, address, "WELCOME10")) == "already_used"

    def test_placement_rechecks_the_coupon(self, client, address, products, admin_headers):
        """Valid at quote time, disabled before the shopper clicks Place order."""
        add(client, products["KIT-001"])
        q = quote_with(client, address, "SAVE5")
        assert q.status_code == 422  # $24.99 < $30 min spend - use a code that fits:
        q = quote_with(client, address, "WELCOME10").json()
        coupon_id = next(
            c["id"]
            for c in client.get(ADMIN_COUPONS, headers=admin_headers).json()
            if c["code"] == "WELCOME10"
        )
        client.patch(
            f"{ADMIN_COUPONS}/{coupon_id}", json={"is_active": False}, headers=admin_headers
        )
        r = client.post(
            PLACE,
            json={
                "address_id": address["id"],
                "coupon_code": "WELCOME10",
                "expected_total_cents": q["total_cents"],
            },
            headers={"Idempotency-Key": key()},
        )
        assert rejection(r) == "invalid"

    def test_dropping_the_coupon_changes_the_total(self, client, address, products):
        """A client that quoted with a code but places without it gets 409, not a surprise."""
        add(client, products["KIT-001"], 2)
        q = quote_with(client, address, "WELCOME10").json()
        r = client.post(
            PLACE,
            json={"address_id": address["id"], "expected_total_cents": q["total_cents"]},
            headers={"Idempotency-Key": key()},
        )
        assert r.status_code == 409
        assert error_code(r) == "total_changed"

    def test_replay_with_a_different_coupon_is_refused(self, client, address, products):
        add(client, products["KIT-001"], 2)
        idem = key()
        assert place_with(client, address, coupon="WELCOME10", idem=idem).status_code == 201
        add(client, products["KIT-001"], 2)
        r = client.post(
            PLACE,
            json={"address_id": address["id"], "expected_total_cents": 1},
            headers={"Idempotency-Key": idem},
        )
        assert error_code(r) == "idempotency_key_reused"

    def test_replay_with_the_same_coupon_returns_the_order(self, client, address, products):
        add(client, products["KIT-001"], 2)
        idem = key()
        first = place_with(client, address, coupon="WELCOME10", idem=idem).json()
        again = client.post(
            PLACE,
            json={
                "address_id": address["id"],
                "shipping_method": "standard",
                "coupon_code": "WELCOME10",
                "expected_total_cents": first["total_cents"],
            },
            headers={"Idempotency-Key": idem},
        )
        assert again.status_code == 200
        assert again.json()["order_number"] == first["order_number"]


class TestAdmin:
    def test_list_shows_uses_and_state(self, client, address, products, admin_headers):
        add(client, products["KIT-001"])
        place_with(client, address, coupon="WELCOME10")
        coupons = {c["code"]: c for c in client.get(ADMIN_COUPONS, headers=admin_headers).json()}
        assert coupons["WELCOME10"]["uses"] == 1
        assert coupons["WELCOME10"]["state"] == "active"
        assert coupons["SPRING25"]["state"] == "expired"

    def test_create_uppercases_the_code(self, make_coupon):
        assert make_coupon("summer-5")["code"] == "SUMMER-5"

    def test_duplicate_code_is_409(self, client, admin_headers, make_coupon):
        make_coupon("TWICE")
        r = client.post(
            ADMIN_COUPONS,
            json={"code": "twice", "kind": "fixed", "amount_off_cents": 100},
            headers=admin_headers,
        )
        assert r.status_code == 409
        assert error_code(r) == "coupon_code_taken"

    @pytest.mark.parametrize(
        "body",
        [
            {"kind": "percent"},  # no amount
            {"kind": "percent", "percent_off": 0},
            {"kind": "percent", "percent_off": 101},
            {"kind": "percent", "percent_off": 10, "amount_off_cents": 100},  # both
            {"kind": "fixed", "percent_off": 10},
            {"kind": "fixed", "amount_off_cents": 0},
            {"kind": "fixed", "amount_off_cents": 100, "per_user_limit": 0},
            {"kind": "fixed", "amount_off_cents": 100, "max_redemptions": 0},
            {"kind": "fixed", "amount_off_cents": 100, "starts_at": "2026-01-01T00:00:00"},  # no tz
            {
                "kind": "fixed",
                "amount_off_cents": 100,
                "starts_at": "2026-02-01T00:00:00Z",
                "expires_at": "2026-01-01T00:00:00Z",
            },
        ],
    )
    def test_invalid_coupons_are_422(self, client, admin_headers, body):
        r = client.post(ADMIN_COUPONS, json={"code": "BADONE", **body}, headers=admin_headers)
        assert r.status_code == 422, r.text

    def test_update_limits_and_disable(self, client, admin_headers, make_coupon):
        c = make_coupon("TUNE", max_redemptions=5)
        r = client.patch(
            f"{ADMIN_COUPONS}/{c['id']}",
            json={"max_redemptions": None, "per_user_limit": 3, "is_active": False},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert (r.json()["max_redemptions"], r.json()["per_user_limit"]) == (None, 3)
        assert r.json()["state"] == "disabled"

    @pytest.mark.parametrize("field", ["code", "kind", "percent_off", "amount_off_cents"])
    def test_identity_fields_are_immutable(self, client, admin_headers, make_coupon, field):
        c = make_coupon("FROZEN")
        value = {"code": "OTHER", "kind": "fixed", "percent_off": 50, "amount_off_cents": 1}
        r = client.patch(
            f"{ADMIN_COUPONS}/{c['id']}", json={field: value[field]}, headers=admin_headers
        )
        assert r.status_code == 422

    def test_update_checks_the_window_against_stored_values(
        self, client, admin_headers, make_coupon
    ):
        c = make_coupon("LATE", expires_at="2027-01-01T00:00:00Z")
        r = client.patch(
            f"{ADMIN_COUPONS}/{c['id']}",
            json={"starts_at": "2027-06-01T00:00:00Z"},
            headers=admin_headers,
        )
        assert r.status_code == 422
        assert "expires_at" in r.json()["error"]["fields"]

    def test_required_fields_cannot_be_nulled(self, client, admin_headers, make_coupon):
        c = make_coupon("KEEP")
        r = client.patch(
            f"{ADMIN_COUPONS}/{c['id']}", json={"per_user_limit": None}, headers=admin_headers
        )
        assert r.status_code == 422

    def test_unknown_coupon_is_404(self, client, admin_headers):
        assert client.get(f"{ADMIN_COUPONS}/999999", headers=admin_headers).status_code == 404

    def test_customers_cannot_manage_coupons(self, client, customer):
        assert client.get(ADMIN_COUPONS).status_code == 403


def _address() -> dict:
    from tests.helpers import VALID_ADDRESS

    return VALID_ADDRESS
