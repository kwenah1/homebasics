"""WSH-01..04: saving products, idempotency, the size limit, archived items and move-to-cart."""

import pytest
from sqlalchemy import func, select

from app.models import Product, WishlistItem
from app.services.wishlist import WISHLIST_LIMIT
from tests.helpers import error_code

URL = "/api/v1/me/wishlist"


def skus(client) -> list[str]:
    return [i["product"]["sku"] for i in client.get(URL).json()["items"]]


def test_requires_sign_in(client, products):
    assert client.get(URL).status_code == 401
    assert client.put(f"{URL}/{products['KIT-001'].id}").status_code == 401


def test_add_list_newest_first(client, customer, products):
    client.put(f"{URL}/{products['KIT-001'].id}")
    r = client.put(f"{URL}/{products['CLN-001'].id}")
    assert r.status_code == 200
    assert [i["product"]["sku"] for i in r.json()["items"]] == ["CLN-001", "KIT-001"]
    assert (r.json()["count"], r.json()["limit"]) == (2, WISHLIST_LIMIT)


def test_items_carry_live_price_and_stock(client, db, customer, products):
    pan = products["KIT-001"]
    client.put(f"{URL}/{pan.id}")
    pan.price_cents, pan.stock_qty = 1999, 3
    db.flush()
    item = client.get(URL).json()["items"][0]
    assert (item["product"]["price_cents"], item["product"]["stock_status"]) == (1999, "low_stock")
    assert (item["product"]["stock_left"], item["available"]) == (3, True)


def test_adding_twice_is_idempotent(client, db, customer, products):
    for _ in range(3):
        assert client.put(f"{URL}/{products['KIT-001'].id}").status_code == 200
    assert skus(client) == ["KIT-001"]
    assert db.scalar(select(func.count()).select_from(WishlistItem)) >= 1


def test_remove_is_idempotent(client, customer, products):
    pan = products["KIT-001"]
    client.put(f"{URL}/{pan.id}")
    assert client.delete(f"{URL}/{pan.id}").status_code == 204
    assert client.delete(f"{URL}/{pan.id}").status_code == 204
    assert skus(client) == []


@pytest.mark.parametrize("which", ["unknown", "archived"])
def test_only_visible_products_can_be_saved(client, db, customer, which):
    product_id = (
        999999
        if which == "unknown"
        else db.scalar(select(Product.id).where(Product.is_archived.is_(True)))
    )
    r = client.put(f"{URL}/{product_id}")
    assert (r.status_code, error_code(r)) == (404, "product_not_found")


def test_archived_later_stays_but_is_unavailable(client, db, customer, products):
    pan = products["KIT-001"]
    client.put(f"{URL}/{pan.id}")
    pan.is_archived = True
    db.flush()
    item = client.get(URL).json()["items"][0]
    assert (item["product"]["sku"], item["available"]) == ("KIT-001", False)


def test_limit(client, db, customer):
    ids = db.scalars(
        select(Product.id).where(Product.is_archived.is_(False)).order_by(Product.id)
    ).all()
    for product_id in ids[:WISHLIST_LIMIT]:
        assert client.put(f"{URL}/{product_id}").status_code == 200
    r = client.put(f"{URL}/{ids[WISHLIST_LIMIT]}")
    assert (r.status_code, error_code(r)) == (409, "wishlist_full")
    # Re-saving something already there is still fine at the limit.
    assert client.put(f"{URL}/{ids[0]}").status_code == 200


def test_lists_are_private(client, customer, make_user, auth_as, products):
    client.put(f"{URL}/{products['KIT-001'].id}")
    other, password = make_user()
    auth_as(other.email, password)
    assert skus(client) == []


class TestMoveToCart:
    def test_moves_one_unit_and_removes_from_the_list(self, client, customer, products):
        pan = products["KIT-001"]
        client.put(f"{URL}/{pan.id}")
        r = client.post(f"{URL}/{pan.id}/move-to-cart")
        assert r.status_code == 200
        assert [(line["sku"], line["quantity"]) for line in r.json()["items"]] == [("KIT-001", 1)]
        assert skus(client) == []

    def test_out_of_stock_stays_on_the_list(self, client, db, customer, products):
        pan = products["KIT-001"]
        client.put(f"{URL}/{pan.id}")
        pan.stock_qty = 0
        db.flush()
        r = client.post(f"{URL}/{pan.id}/move-to-cart")
        assert (r.status_code, error_code(r)) == (409, "out_of_stock")
        assert skus(client) == ["KIT-001"]
        assert client.get("/api/v1/cart").json()["items"] == []

    def test_line_limit_stays_on_the_list(self, client, customer, products):
        pan = products["KIT-001"]
        client.post("/api/v1/cart/items", json={"product_id": pan.id, "quantity": 10})
        client.put(f"{URL}/{pan.id}")
        r = client.post(f"{URL}/{pan.id}/move-to-cart")
        assert (r.status_code, error_code(r)) == (409, "quantity_limit")
        assert skus(client) == ["KIT-001"]

    def test_not_on_the_list_is_404(self, client, customer, products):
        r = client.post(f"{URL}/{products['KIT-001'].id}/move-to-cart")
        assert (r.status_code, error_code(r)) == (404, "not_in_wishlist")
