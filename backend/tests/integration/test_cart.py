"""CRT-01..04 against the real database."""

import pytest
from sqlalchemy import select

from app.models import Product
from tests.helpers import error_code

CART = "/api/v1/cart"
ITEMS = f"{CART}/items"


@pytest.fixture
def products(db):
    """sku -> Product for the seeded catalog."""
    return {p.sku: p for p in db.scalars(select(Product))}


def add(client, product, quantity=1):
    return client.post(ITEMS, json={"product_id": product.id, "quantity": quantity})


def lines(response):
    return {line["sku"]: line for line in response.json()["items"]}


class TestAuth:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", CART),
            ("post", ITEMS),
            ("patch", f"{ITEMS}/1"),
            ("delete", f"{ITEMS}/1"),
            ("delete", CART),
            ("post", f"{CART}/merge"),
            ("post", f"{CART}/acknowledge-prices"),
        ],
    )
    def test_saved_cart_needs_sign_in(self, client, method, path):
        response = client.request(method, path, json={"product_id": 1, "quantity": 1, "items": []})
        assert response.status_code == 401

    def test_preview_is_public(self, client):
        assert client.post(f"{CART}/preview", json={"items": []}).status_code == 200


class TestAdd:
    def test_empty_cart(self, client, customer):
        body = client.get(CART).json()
        assert body["items"] == []
        assert (body["item_count"], body["subtotal_cents"]) == (0, 0)
        assert body["amount_to_free_shipping_cents"] == 5000

    def test_add_and_totals(self, client, customer, products):
        add(client, products["KIT-001"], 2)  # 24.99
        body = add(client, products["CLN-001"], 3).json()  # 4.99
        assert [line["sku"] for line in body["items"]] == ["KIT-001", "CLN-001"]  # added order
        assert body["item_count"] == 5
        assert body["subtotal_cents"] == 2 * 2499 + 3 * 499
        assert lines_of(body)["KIT-001"]["line_total_cents"] == 4998

    def test_adding_same_product_increments(self, client, customer, products):
        add(client, products["KIT-001"], 2)
        body = add(client, products["KIT-001"], 3)
        assert lines(body)["KIT-001"]["quantity"] == 5
        assert len(body.json()["items"]) == 1

    def test_ten_is_allowed_eleven_is_not(self, client, customer, products):
        """CRT-01 boundary."""
        assert add(client, products["CLN-001"], 10).status_code == 200
        response = add(client, products["CLN-001"], 1)
        assert response.status_code == 409
        assert error_code(response) == "quantity_limit"
        assert response.json()["error"]["max_quantity"] == 10
        assert response.json()["error"]["in_cart"] == 10

    def test_limited_by_stock(self, client, customer, products):
        """KIT-005 has exactly 5 in stock."""
        assert add(client, products["KIT-005"], 5).status_code == 200
        response = add(client, products["KIT-005"], 1)
        assert response.status_code == 409
        assert response.json()["error"]["max_quantity"] == 5

    def test_rejected_add_changes_nothing(self, client, customer, products):
        add(client, products["KIT-005"], 3)
        add(client, products["KIT-005"], 3)  # 6 > 5: rejected
        assert lines(client.get(CART))["KIT-005"]["quantity"] == 3

    def test_out_of_stock(self, client, customer, products):
        response = add(client, products["KIT-009"])
        assert response.status_code == 409
        assert error_code(response) == "out_of_stock"

    @pytest.mark.parametrize("sku", ["KIT-900"])  # archived
    def test_archived_product_is_404(self, client, customer, products, sku):
        assert error_code(add(client, products[sku])) == "product_not_found"

    def test_unknown_product_is_404(self, client, customer):
        response = client.post(ITEMS, json={"product_id": 999999})
        assert response.status_code == 404

    @pytest.mark.parametrize("quantity", [0, -1, 11, 2.5, "two"])
    def test_invalid_quantity_is_422(self, client, customer, products, quantity):
        response = client.post(
            ITEMS, json={"product_id": products["KIT-001"].id, "quantity": quantity}
        )
        assert response.status_code == 422

    def test_price_cannot_be_supplied_by_the_client(self, client, customer, products):
        response = client.post(
            ITEMS, json={"product_id": products["KIT-001"].id, "unit_price_cents": 1}
        )
        assert response.status_code == 422


def lines_of(body):
    return {line["sku"]: line for line in body["items"]}


class TestUpdateRemove:
    def test_set_quantity(self, client, customer, products):
        add(client, products["KIT-001"], 2)
        response = client.patch(f"{ITEMS}/{products['KIT-001'].id}", json={"quantity": 7})
        assert lines(response)["KIT-001"]["quantity"] == 7

    def test_set_above_stock(self, client, customer, products):
        add(client, products["KIT-005"], 1)
        response = client.patch(f"{ITEMS}/{products['KIT-005'].id}", json={"quantity": 6})
        assert response.status_code == 409
        assert response.json()["error"] == {
            "code": "insufficient_stock",
            "message": "Only 5 available.",
            "available": 5,
        }

    @pytest.mark.parametrize("quantity", [0, 11])
    def test_set_out_of_range(self, client, customer, products, quantity):
        add(client, products["KIT-001"])
        response = client.patch(f"{ITEMS}/{products['KIT-001'].id}", json={"quantity": quantity})
        assert response.status_code == 422

    def test_update_or_remove_item_not_in_cart(self, client, customer, products):
        pid = products["KIT-001"].id
        assert error_code(client.patch(f"{ITEMS}/{pid}", json={"quantity": 1})) == "not_in_cart"
        assert error_code(client.delete(f"{ITEMS}/{pid}")) == "not_in_cart"

    def test_remove(self, client, customer, products):
        add(client, products["KIT-001"])
        add(client, products["CLN-001"])
        body = client.delete(f"{ITEMS}/{products['KIT-001'].id}").json()
        assert [line["sku"] for line in body["items"]] == ["CLN-001"]

    def test_clear(self, client, customer, products):
        add(client, products["KIT-001"])
        assert client.delete(CART).status_code == 204
        assert client.get(CART).json()["items"] == []


class TestIsolation:
    def test_carts_are_per_user(self, client, make_user, auth_as, products):
        alice, alice_pw = make_user()
        auth_as(alice.email, alice_pw)
        add(client, products["KIT-001"], 3)

        bob, bob_pw = make_user()
        auth_as(bob.email, bob_pw)
        assert client.get(CART).json()["items"] == []
        # Bob can't reach Alice's line by product id either: it's simply not in *his* cart.
        assert error_code(client.delete(f"{ITEMS}/{products['KIT-001'].id}")) == "not_in_cart"

        auth_as(alice.email, alice_pw)
        assert lines(client.get(CART))["KIT-001"]["quantity"] == 3


class TestNoReservation:
    """CRT-04: the cart holds no stock; lines are re-validated on every read."""

    def test_stock_drop_flags_line_and_excludes_it_from_subtotal(
        self, client, db, customer, products
    ):
        add(client, products["KIT-001"], 4)
        add(client, products["CLN-001"], 1)
        products["KIT-001"].stock_qty = 2
        db.flush()

        body = client.get(CART).json()
        line = lines_of(body)["KIT-001"]
        assert (line["issue"], line["available"], line["quantity"]) == ("insufficient_stock", 2, 4)
        assert body["has_issues"] is True
        assert body["subtotal_cents"] == 499  # only the healthy line counts

    def test_sold_out_after_adding(self, client, db, customer, products):
        add(client, products["KIT-001"])
        products["KIT-001"].stock_qty = 0
        db.flush()
        assert lines(client.get(CART))["KIT-001"]["issue"] == "out_of_stock"

    def test_archived_after_adding(self, client, db, customer, products):
        add(client, products["KIT-001"])
        products["KIT-001"].is_archived = True
        db.flush()
        body = client.get(CART).json()
        assert lines_of(body)["KIT-001"]["issue"] == "unavailable"
        assert lines_of(body)["KIT-001"]["max_order_qty"] == 0
        # Can't change its quantity, but can remove it.
        pid = products["KIT-001"].id
        assert (
            error_code(client.patch(f"{ITEMS}/{pid}", json={"quantity": 1}))
            == "product_unavailable"
        )
        assert client.delete(f"{ITEMS}/{pid}").status_code == 200

    def test_two_shoppers_can_both_hold_the_last_unit(self, client, make_user, auth_as, products):
        """Only one of them will be able to check out (M5), but adding never blocks."""
        for _ in range(2):
            user, pw = make_user()
            auth_as(user.email, pw)
            assert add(client, products["CLN-005"], 1).status_code == 200  # stock 1


class TestPriceChanges:
    """CRT-03"""

    def test_price_rise_is_flagged_and_current_price_is_used(self, client, db, customer, products):
        add(client, products["KIT-001"], 2)  # 24.99
        products["KIT-001"].price_cents = 2799
        db.flush()

        body = client.get(CART).json()
        line = lines_of(body)["KIT-001"]
        assert (line["price_when_added_cents"], line["unit_price_cents"]) == (2499, 2799)
        assert line["price_change_cents"] == 300
        assert body["has_price_changes"] is True
        assert body["subtotal_cents"] == 2 * 2799  # always today's price

    def test_price_drop_is_flagged_too(self, client, db, customer, products):
        add(client, products["KIT-001"])
        products["KIT-001"].price_cents = 1999
        db.flush()
        assert lines(client.get(CART))["KIT-001"]["price_change_cents"] == -500

    def test_acknowledge_clears_the_notice(self, client, db, customer, products):
        add(client, products["KIT-001"])
        products["KIT-001"].price_cents = 2799
        db.flush()
        body = client.post(f"{CART}/acknowledge-prices").json()
        assert body["has_price_changes"] is False
        assert lines_of(body)["KIT-001"]["price_when_added_cents"] == 2799

    def test_adding_more_keeps_the_original_recorded_price(self, client, db, customer, products):
        add(client, products["KIT-001"])
        products["KIT-001"].price_cents = 2799
        db.flush()
        body = add(client, products["KIT-001"])
        assert lines(body)["KIT-001"]["price_when_added_cents"] == 2499


class TestFreeShippingEstimate:
    @pytest.mark.parametrize(
        ("sku", "qty", "gap"),
        [("KIT-006", 1, 1), ("KIT-007", 1, 0), ("CLN-001", 1, 5000 - 499)],  # $49.99, $50.00
    )
    def test_gap(self, client, customer, products, sku, qty, gap):
        body = add(client, products[sku], qty).json()
        assert body["amount_to_free_shipping_cents"] == gap


class TestPreview:
    def test_preview_matches_a_saved_cart(self, client, customer, products):
        """The guest view and the account view must agree exactly."""
        wanted = [("KIT-001", 2), ("CLN-001", 3), ("KIT-005", 5)]
        for sku, qty in wanted:
            add(client, products[sku], qty)
        saved = client.get(CART).json()

        preview = client.post(
            f"{CART}/preview",
            json={"items": [{"product_id": products[s].id, "quantity": q} for s, q in wanted]},
        ).json()
        assert preview == saved

    def test_preview_reports_unknown_ids_and_flags_problems(self, client, products):
        body = client.post(
            f"{CART}/preview",
            json={
                "items": [
                    {"product_id": 999999, "quantity": 1},
                    {"product_id": products["KIT-009"].id, "quantity": 1},  # out of stock
                    {"product_id": products["KIT-900"].id, "quantity": 1},  # archived
                    {"product_id": products["CLN-005"].id, "quantity": 3},  # stock 1
                ]
            },
        ).json()
        assert body["unknown_product_ids"] == [999999]
        assert {line["sku"]: line["issue"] for line in body["items"]} == {
            "KIT-009": "out_of_stock",
            "KIT-900": "unavailable",
            "CLN-005": "insufficient_stock",
        }
        assert body["subtotal_cents"] == 0

    def test_preview_flags_price_change_from_price_seen(self, client, products):
        body = client.post(
            f"{CART}/preview",
            json={
                "items": [
                    {"product_id": products["KIT-001"].id, "quantity": 1, "price_cents_seen": 1999}
                ]
            },
        ).json()
        assert body["items"][0]["price_change_cents"] == 500
        assert body["items"][0]["unit_price_cents"] == 2499  # the seen price is never charged

    def test_preview_line_limit(self, client):
        items = [{"product_id": i, "quantity": 1} for i in range(1, 52)]
        assert client.post(f"{CART}/preview", json={"items": items}).status_code == 422

    def test_preview_stores_nothing(self, client, customer, products):
        client.post(
            f"{CART}/preview",
            json={"items": [{"product_id": products["KIT-001"].id, "quantity": 1}]},
        )
        assert client.get(CART).json()["items"] == []


class TestMerge:
    """CRT-02: sum, cap at min(10, stock), skip what can't be bought, report everything."""

    def merge(self, client, *items):
        return client.post(
            f"{CART}/merge",
            json={"items": [{"product_id": p.id, "quantity": q} for p, q in items]},
        )

    def test_merge_into_empty_account_cart(self, client, customer, products):
        body = self.merge(client, (products["KIT-001"], 2), (products["CLN-001"], 1)).json()
        assert {line["sku"]: line["quantity"] for line in body["cart"]["items"]} == {
            "KIT-001": 2,
            "CLN-001": 1,
        }
        assert body["report"] == {"capped": [], "skipped": []}

    def test_quantities_are_summed(self, client, customer, products):
        add(client, products["KIT-001"], 2)
        body = self.merge(client, (products["KIT-001"], 3)).json()
        assert lines_of(body["cart"])["KIT-001"]["quantity"] == 5

    def test_capped_at_ten(self, client, customer, products):
        add(client, products["CLN-001"], 6)
        body = self.merge(client, (products["CLN-001"], 6)).json()
        assert lines_of(body["cart"])["CLN-001"]["quantity"] == 10
        assert body["report"]["capped"] == [
            {"product_id": products["CLN-001"].id, "requested": 12, "kept": 10}
        ]

    def test_capped_at_stock(self, client, customer, products):
        add(client, products["KIT-005"], 3)  # stock 5
        body = self.merge(client, (products["KIT-005"], 4)).json()
        assert lines_of(body["cart"])["KIT-005"]["quantity"] == 5
        assert body["report"]["capped"][0]["kept"] == 5

    def test_duplicate_guest_lines_are_summed_first(self, client, customer, products):
        body = self.merge(client, (products["KIT-001"], 2), (products["KIT-001"], 3)).json()
        assert lines_of(body["cart"])["KIT-001"]["quantity"] == 5

    def test_unbuyable_items_are_skipped_and_reported(self, client, customer, products):
        body = client.post(
            f"{CART}/merge",
            json={
                "items": [
                    {"product_id": products["KIT-009"].id, "quantity": 1},
                    {"product_id": products["KIT-900"].id, "quantity": 1},
                    {"product_id": 999999, "quantity": 1},
                    {"product_id": products["KIT-001"].id, "quantity": 1},
                ]
            },
        ).json()
        assert [line["sku"] for line in body["cart"]["items"]] == ["KIT-001"]
        assert body["report"]["skipped"] == [
            {"product_id": products["KIT-009"].id, "reason": "out_of_stock"},
            {"product_id": products["KIT-900"].id, "reason": "unavailable"},
            {"product_id": 999999, "reason": "unavailable"},
        ]

    def test_account_price_record_is_kept_on_merge(self, client, db, customer, products):
        add(client, products["KIT-001"], 1)
        products["KIT-001"].price_cents = 2799
        db.flush()
        body = self.merge(client, (products["KIT-001"], 1)).json()
        assert lines_of(body["cart"])["KIT-001"]["price_when_added_cents"] == 2499

    def test_empty_merge_is_a_no_op(self, client, customer, products):
        add(client, products["KIT-001"], 2)
        body = client.post(f"{CART}/merge", json={"items": []}).json()
        assert lines_of(body["cart"])["KIT-001"]["quantity"] == 2
