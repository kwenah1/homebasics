"""ADM-01..04: back office."""

import re
import uuid

import pytest
from sqlalchemy import func, select

from app.main import create_app
from app.models import InventoryMovement, Product
from app.services.payments import SUCCESS_CARD
from tests.helpers import VALID_ADDRESS, error_code

ADMIN = "/api/v1/admin"


# --- ADM-04: every admin route is guarded ---------------------------------------------------


def admin_routes() -> list[tuple[str, str]]:
    """Every (method, path) under /api/v1/admin, read from the OpenAPI spec - a new route is
    covered by these tests automatically."""
    spec = create_app().openapi()
    routes = []
    for path, ops in spec["paths"].items():
        if path.startswith(ADMIN):
            concrete = re.sub(r"\{[^}]+\}", "1", path)
            routes += [(method.upper(), concrete) for method in ops]
    return sorted(routes)


ROUTES = admin_routes()


def test_admin_surface_is_what_we_expect():
    assert len(ROUTES) == 17  # update deliberately when adding admin endpoints


@pytest.mark.parametrize(("method", "path"), ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_anonymous_gets_401(client, method, path):
    assert client.request(method, path, json={}).status_code == 401


@pytest.mark.parametrize(("method", "path"), ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_customer_gets_403(client, customer, method, path):
    response = client.request(method, path, json={})
    assert (response.status_code, error_code(response)) == (403, "forbidden")


@pytest.mark.parametrize(("method", "path"), ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_admin_is_let_through(client, admin_headers, method, path):
    response = client.request(method, path, json={}, headers=admin_headers)
    assert response.status_code not in (401, 403), response.text


# --- ADM-01: products -------------------------------------------------------------------------


@pytest.fixture
def kitchen_id(client, admin_headers):
    cats = client.get(f"{ADMIN}/categories", headers=admin_headers).json()
    return next(c["id"] for c in cats if c["slug"] == "kitchen")


def new_product(client, admin_headers, kitchen_id, **overrides):
    tag = uuid.uuid4().hex[:6].upper()
    body = {
        "category_id": kitchen_id,
        "sku": f"TST-{tag}",
        "name": f"Test Whisk {tag}",
        "description": "Balloon whisk.",
        "price_cents": 899,
        "initial_stock": 12,
        **overrides,
    }
    return client.post(f"{ADMIN}/products", json=body, headers=admin_headers)


class TestProducts:
    def test_create_is_immediately_on_sale(self, client, admin_headers, kitchen_id):
        response = new_product(client, admin_headers, kitchen_id)
        assert response.status_code == 201
        product = response.json()
        assert product["slug"] == product["name"].lower().replace(" ", "-")
        assert (product["stock_qty"], product["is_archived"]) == (12, False)

        public = client.get(f"/api/v1/products/{product['slug']}").json()
        assert (public["price_cents"], public["stock_status"]) == (899, "in_stock")

    def test_initial_stock_is_in_the_ledger(self, client, admin_headers, kitchen_id):
        product = new_product(client, admin_headers, kitchen_id).json()
        ledger = client.get(
            f"{ADMIN}/products/{product['id']}/stock-movements", headers=admin_headers
        ).json()
        assert [(m["delta"], m["reason"], m["actor_email"]) for m in ledger["movements"]] == [
            (12, "initial", "admin@homebasics.test")
        ]

    def test_sku_is_uppercased(self, client, admin_headers, kitchen_id):
        product = new_product(client, admin_headers, kitchen_id, sku="low-case1").json()
        assert product["sku"] == "LOW-CASE1"

    def test_duplicate_sku(self, client, admin_headers, kitchen_id):
        response = new_product(client, admin_headers, kitchen_id, sku="KIT-001")
        assert (response.status_code, error_code(response)) == (409, "sku_taken")

    def test_duplicate_name(self, client, admin_headers, kitchen_id):
        response = new_product(client, admin_headers, kitchen_id, name="Chef's Knife 8in")
        assert (response.status_code, error_code(response)) == (409, "name_taken")

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("sku", "nodash"),
            ("sku", "A-B"),
            ("price_cents", 0),
            ("price_cents", -5),
            ("price_cents", 1_000_001),
            ("name", " "),
            ("initial_stock", -1),
            ("category_id", 999999),
        ],
    )
    def test_invalid_fields(self, client, admin_headers, kitchen_id, field, value):
        response = new_product(client, admin_headers, kitchen_id, **{field: value})
        assert response.status_code == 422
        assert field in response.json()["error"]["fields"]

    def test_edit_price_and_name_keeps_slug(self, client, admin_headers, kitchen_id):
        product = new_product(client, admin_headers, kitchen_id).json()
        response = client.patch(
            f"{ADMIN}/products/{product['id']}",
            json={"price_cents": 1099, "name": "Renamed Whisk"},
            headers=admin_headers,
        )
        assert response.json()["slug"] == product["slug"]  # links keep working
        public = client.get(f"/api/v1/products/{product['slug']}").json()
        assert (public["name"], public["price_cents"]) == ("Renamed Whisk", 1099)

    @pytest.mark.parametrize("field", [{"sku": "NEW-001"}, {"stock_qty": 99}, {"slug": "x"}])
    def test_sku_slug_and_stock_cannot_be_edited(self, client, admin_headers, kitchen_id, field):
        product = new_product(client, admin_headers, kitchen_id).json()
        response = client.patch(
            f"{ADMIN}/products/{product['id']}", json=field, headers=admin_headers
        )
        assert response.status_code == 422

    def test_archive_hides_from_store_and_unarchive_restores(
        self, client, admin_headers, kitchen_id
    ):
        product = new_product(client, admin_headers, kitchen_id).json()
        client.post(f"{ADMIN}/products/{product['id']}/archive", headers=admin_headers)
        assert client.get(f"/api/v1/products/{product['slug']}").status_code == 404
        search = client.get("/api/v1/products", params={"q": product["name"]}).json()
        assert search["total"] == 0

        client.post(f"{ADMIN}/products/{product['id']}/unarchive", headers=admin_headers)
        assert client.get(f"/api/v1/products/{product['slug']}").status_code == 200

    def test_admin_list_shows_exact_stock_and_filters(self, client, admin_headers):
        body = client.get(
            f"{ADMIN}/products", params={"q": "CLN-005"}, headers=admin_headers
        ).json()
        assert [(p["sku"], p["stock_qty"]) for p in body["items"]] == [("CLN-005", 1)]
        archived = client.get(
            f"{ADMIN}/products", params={"archived": "archived"}, headers=admin_headers
        ).json()
        assert [p["sku"] for p in archived["items"]] == ["KIT-900"]
        everything = client.get(
            f"{ADMIN}/products", params={"page_size": 100}, headers=admin_headers
        ).json()
        assert everything["total"] == 61


# --- ADM-02: stock --------------------------------------------------------------------------


class TestStock:
    @pytest.fixture
    def product(self, client, admin_headers, kitchen_id):
        return new_product(client, admin_headers, kitchen_id, initial_stock=5).json()

    def adjust(self, client, admin_headers, product, delta, reason, note=None):
        return client.post(
            f"{ADMIN}/products/{product['id']}/stock-adjustments",
            json={"delta": delta, "reason": reason, "note": note},
            headers=admin_headers,
        )

    @pytest.mark.parametrize(
        ("delta", "reason", "stock"),
        [(10, "restock", 15), (-2, "damaged", 3), (-5, "adjustment", 0), (3, "adjustment", 8)],
    )
    def test_valid_adjustments(self, client, admin_headers, product, delta, reason, stock):
        response = self.adjust(client, admin_headers, product, delta, reason, "cycle count")
        assert response.json()["stock_qty"] == stock

    @pytest.mark.parametrize(
        ("delta", "reason"), [(-1, "restock"), (1, "damaged"), (0, "adjustment"), (5, "stolen")]
    )
    def test_reason_must_fit_the_direction(self, client, admin_headers, product, delta, reason):
        assert self.adjust(client, admin_headers, product, delta, reason).status_code == 422

    def test_never_below_zero(self, client, admin_headers, product):
        response = self.adjust(client, admin_headers, product, -6, "damaged")
        assert response.status_code == 409
        assert response.json()["error"]["available"] == 5

    def test_stock_zero_shows_out_of_stock_to_shoppers(self, client, admin_headers, product):
        self.adjust(client, admin_headers, product, -5, "damaged")
        assert (
            client.get(f"/api/v1/products/{product['slug']}").json()["stock_status"]
            == "out_of_stock"
        )

    def test_ledger_is_newest_first_with_who_and_why(self, client, admin_headers, product):
        self.adjust(client, admin_headers, product, 10, "restock", "PO-1234")
        self.adjust(client, admin_headers, product, -1, "damaged", "dropped")
        ledger = client.get(
            f"{ADMIN}/products/{product['id']}/stock-movements", headers=admin_headers
        ).json()
        assert [(m["delta"], m["reason"], m["note"]) for m in ledger["movements"]] == [
            (-1, "damaged", "dropped"),
            (10, "restock", "PO-1234"),
            (5, "initial", None),
        ]
        assert ledger["ledger_total"] == ledger["stock_qty"] == 14


def test_ledger_reconciles_for_every_product_after_orders(client, db, customer, admin_headers):
    """The central inventory invariant: sum(movements) == stock_qty for EVERY product, after
    placing, paying, cancelling, and admin adjustments."""
    address = client.post("/api/v1/me/addresses", json=VALID_ADDRESS).json()
    products = {p.sku: p for p in db.scalars(select(Product))}

    def order(sku, qty):
        client.post("/api/v1/cart/items", json={"product_id": products[sku].id, "quantity": qty})
        total = client.post("/api/v1/checkout/quote", json={"address_id": address["id"]}).json()[
            "total_cents"
        ]
        return client.post(
            "/api/v1/checkout/place-order",
            json={"address_id": address["id"], "expected_total_cents": total},
            headers={"Idempotency-Key": uuid.uuid4().hex},
        ).json()["order_number"]

    first = order("CLN-001", 3)
    order("KIT-001", 2)
    client.post(
        f"/api/v1/orders/{first}/pay",
        json={
            "card_number": SUCCESS_CARD,
            "exp_month": 12,
            "exp_year": 2035,
            "cvc": "123",
            "name_on_card": "C",
        },
        headers={"Idempotency-Key": uuid.uuid4().hex},
    )
    client.post(f"/api/v1/orders/{first}/cancel")
    client.post(
        f"{ADMIN}/products/{products['KIT-005'].id}/stock-adjustments",
        json={"delta": -2, "reason": "damaged"},
        headers=admin_headers,
    )

    ledger = dict(
        db.execute(
            select(InventoryMovement.product_id, func.sum(InventoryMovement.delta)).group_by(
                InventoryMovement.product_id
            )
        ).all()
    )
    db.expire_all()
    for product in db.scalars(select(Product)):
        assert ledger.get(product.id, 0) == product.stock_qty, product.sku


# --- Categories -------------------------------------------------------------------------------


class TestCategories:
    def test_create_rename_delete(self, client, admin_headers):
        created = client.post(
            f"{ADMIN}/categories", json={"name": "Garden Tools"}, headers=admin_headers
        )
        assert created.status_code == 201
        cat = created.json()
        assert (cat["slug"], cat["active_products"]) == ("garden-tools", 0)

        renamed = client.patch(
            f"{ADMIN}/categories/{cat['id']}", json={"name": "Garden"}, headers=admin_headers
        ).json()
        assert (renamed["name"], renamed["slug"]) == ("Garden", "garden-tools")  # slug stable
        assert (
            client.delete(f"{ADMIN}/categories/{cat['id']}", headers=admin_headers).status_code
            == 204
        )

    @pytest.mark.parametrize("name", ["Kitchen", "KITCHEN", "kitchen"])
    def test_duplicate_name_any_case(self, client, admin_headers, name):
        response = client.post(f"{ADMIN}/categories", json={"name": name}, headers=admin_headers)
        assert (response.status_code, error_code(response)) == (409, "category_exists")

    def test_cannot_delete_a_category_with_products(self, client, admin_headers, kitchen_id):
        response = client.delete(f"{ADMIN}/categories/{kitchen_id}", headers=admin_headers)
        assert (response.status_code, error_code(response)) == (409, "category_not_empty")

    def test_counts_split_active_and_archived(self, client, admin_headers):
        kitchen = next(
            c
            for c in client.get(f"{ADMIN}/categories", headers=admin_headers).json()
            if c["slug"] == "kitchen"
        )
        assert (kitchen["active_products"], kitchen["archived_products"]) == (10, 1)


# --- ADM-03: orders -----------------------------------------------------------------------------


@pytest.fixture
def paid_order(client, db, customer):
    address = client.post("/api/v1/me/addresses", json=VALID_ADDRESS).json()
    spray = db.scalar(select(Product).where(Product.sku == "CLN-001"))
    client.post("/api/v1/cart/items", json={"product_id": spray.id, "quantity": 2})
    total = client.post("/api/v1/checkout/quote", json={"address_id": address["id"]}).json()[
        "total_cents"
    ]
    number = client.post(
        "/api/v1/checkout/place-order",
        json={"address_id": address["id"], "expected_total_cents": total},
        headers={"Idempotency-Key": uuid.uuid4().hex},
    ).json()["order_number"]
    client.post(
        f"/api/v1/orders/{number}/pay",
        json={
            "card_number": SUCCESS_CARD,
            "exp_month": 12,
            "exp_year": 2035,
            "cvc": "123",
            "name_on_card": "C",
        },
        headers={"Idempotency-Key": uuid.uuid4().hex},
    )
    return number


class TestOrders:
    def status(self, client, admin_headers, number, to, note=None):
        return client.post(
            f"{ADMIN}/orders/{number}/status", json={"to": to, "note": note}, headers=admin_headers
        )

    def test_detail_shows_customer_and_next_steps(
        self, client, admin_headers, customer, paid_order
    ):
        order = client.get(f"{ADMIN}/orders/{paid_order}", headers=admin_headers).json()
        assert order["customer_email"] == customer.email
        assert order["next_statuses"] == ["processing", "cancelled"]

    def test_fulfil_and_refund(self, client, admin_headers, paid_order):
        for to in ("processing", "shipped", "delivered"):
            assert self.status(client, admin_headers, paid_order, to).json()["status"] == to
        refunded = client.post(
            f"{ADMIN}/orders/{paid_order}/refund",
            json={"note": "Damaged in transit"},
            headers=admin_headers,
        ).json()
        assert refunded["status"] == "refunded"
        assert [p["status"] for p in refunded["payments"]] == ["succeeded", "refunded"]
        assert refunded["history"][-1]["note"] == "Damaged in transit"
        assert refunded["next_statuses"] == []

    def test_customer_sees_staff_changes(self, client, admin_headers, paid_order):
        self.status(client, admin_headers, paid_order, "processing", "Packing now")
        mine = client.get(f"/api/v1/orders/{paid_order}").json()
        assert (mine["status"], mine["history"][-1]["note"]) == ("processing", "Packing now")

    def test_admin_cancel_restocks_and_refunds(self, client, db, admin_headers, paid_order):
        spray = db.scalar(select(Product).where(Product.sku == "CLN-001"))
        before = spray.stock_qty
        order = self.status(client, admin_headers, paid_order, "cancelled").json()
        db.refresh(spray)
        assert order["status"] == "cancelled"
        assert spray.stock_qty == before + 2
        assert order["history"][-1]["note"].endswith("payment refunded")

    def test_shipped_cannot_be_cancelled_even_by_admin(self, client, admin_headers, paid_order):
        self.status(client, admin_headers, paid_order, "processing")
        self.status(client, admin_headers, paid_order, "shipped")
        response = self.status(client, admin_headers, paid_order, "cancelled")
        assert (response.status_code, error_code(response)) == (409, "invalid_transition")

    @pytest.mark.parametrize("to", ["paid", "pending_payment", "expired", "refunded"])
    def test_admin_cannot_pick_system_statuses(self, client, admin_headers, paid_order, to):
        assert self.status(client, admin_headers, paid_order, to).status_code == 422

    def test_list_filters(self, client, admin_headers, customer, paid_order):
        by_status = client.get(
            f"{ADMIN}/orders", params={"status": "paid"}, headers=admin_headers
        ).json()
        assert paid_order in [o["order_number"] for o in by_status["items"]]
        by_email = client.get(
            f"{ADMIN}/orders", params={"q": customer.email.upper()}, headers=admin_headers
        ).json()
        assert [o["order_number"] for o in by_email["items"]] == [paid_order]
        none = client.get(
            f"{ADMIN}/orders", params={"status": "shipped"}, headers=admin_headers
        ).json()
        assert paid_order not in [o["order_number"] for o in none["items"]]

    def test_unknown_order(self, client, admin_headers):
        assert client.get(f"{ADMIN}/orders/HB-NOPE0000", headers=admin_headers).status_code == 404


def test_summary(client, admin_headers, paid_order):
    body = client.get(f"{ADMIN}/summary", headers=admin_headers).json()
    assert body["orders_by_status"]["paid"] >= 1
    assert body["awaiting_fulfilment"] >= 1
    low = [(i["sku"], i["stock_qty"]) for i in body["low_stock"]]
    assert low[:3] == [("BTH-008", 0), ("KIT-009", 0), ("STR-010", 0)]  # sorted by stock, then SKU
    assert ("CLN-005", 1) in low
    assert all(qty <= 5 for _, qty in low)
