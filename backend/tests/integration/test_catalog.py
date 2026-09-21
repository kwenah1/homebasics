"""CAT-01..05 against the real database, checked against the oracle in catalog_oracle.py."""

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from tests.catalog_oracle import ACTIVE, expected_page
from tests.helpers import error_code

URL = "/api/v1/products"


def skus(response):
    return [p["sku"] for p in response.json()["items"]]


def get(client, **params):
    response = client.get(URL, params={k: v for k, v in params.items() if v is not None})
    assert response.status_code == 200, response.text
    return response


class TestBrowse:
    def test_default_first_page(self, client):
        body = get(client).json()
        assert (body["total"], body["page"], body["page_size"], body["pages"]) == (60, 1, 20, 3)
        assert len(body["items"]) == 20
        assert skus(get(client)) == expected_page()["skus"]

    def test_archived_product_never_listed(self, client):
        everything = (
            get(client, page_size=50).json()["items"]
            + get(client, page_size=50, page=2).json()["items"]
        )
        assert len(everything) == 60
        assert "KIT-900" not in {p["sku"] for p in everything}

    def test_pages_do_not_overlap_and_cover_everything(self, client):
        seen = []
        for page in (1, 2, 3):
            seen += skus(get(client, page=page))
        assert len(seen) == len(set(seen)) == 60

    def test_page_past_the_end_is_empty_not_an_error(self, client):
        body = get(client, page=4).json()
        assert body["items"] == [] and body["total"] == 60 and body["pages"] == 3

    @pytest.mark.parametrize("slug", ["kitchen", "cleaning", "bath", "laundry", "storage"])
    def test_category_filter(self, client, slug):
        body = get(client, category=slug).json()
        assert body["total"] == 10
        assert {p["category"]["slug"] for p in body["items"]} == {slug}

    def test_unknown_category_is_404(self, client):
        response = client.get(URL, params={"category": "garden"})
        assert response.status_code == 404
        assert error_code(response) == "category_not_found"


class TestSearch:
    @pytest.mark.parametrize("q", ["towel", "TOWEL", "  Towel  "])
    def test_case_and_whitespace_insensitive(self, client, q):
        assert skus(get(client, q=q)) == expected_page(q="towel")["skus"]
        assert get(client, q=q).json()["total"] >= 3

    def test_all_terms_must_match(self, client):
        body = get(client, q="bath towel").json()
        assert skus(get(client, q="bath towel")) == expected_page(q="bath towel")["skus"]
        assert body["total"] < get(client, q="towel").json()["total"]

    def test_matches_description_too(self, client):
        # "grease" only appears in descriptions.
        assert set(skus(get(client, q="grease"))) == {"CLN-001", "LND-006"}

    def test_no_results(self, client):
        body = get(client, q="lawnmower").json()
        assert (body["total"], body["pages"], body["items"]) == (0, 0, [])

    @pytest.mark.parametrize("q", ["_", "%%", "\\"])
    def test_like_wildcards_are_literal(self, client, q):
        """Unescaped, '_' or '%%' would match every product; escaped they match nothing."""
        assert get(client, q=q).json()["total"] == 0

    def test_percent_sign_matches_literally(self, client):
        # Only two descriptions contain a real '%': "99.9% of household germs", "100% cotton".
        assert set(skus(get(client, q="%"))) == {"CLN-010", "BTH-010"}
        assert set(skus(get(client, q="99.9%"))) == {"CLN-010"}

    @pytest.mark.parametrize(
        "q", ["' OR 1=1 --", "'; DROP TABLE products; --", '" OR ""="', "towel' --"]
    )
    def test_sql_injection_attempts_are_just_text(self, client, q):
        assert get(client, q=q).json()["total"] == 0
        assert get(client).json()["total"] == 60  # table still there

    def test_query_too_long(self, client):
        assert client.get(URL, params={"q": "x" * 101}).status_code == 422


class TestFilters:
    def test_price_range_is_inclusive(self, client):
        """CHK-03 boundary products: $49.99 and $50.00 are both in [4999, 5000]."""
        got = set(skus(get(client, min_price_cents=4999, max_price_cents=5000)))
        assert got == {"KIT-006", "KIT-007", "STR-008"}

    def test_min_equals_max(self, client):
        assert skus(get(client, min_price_cents=5000, max_price_cents=5000)) == ["KIT-007"]

    def test_min_greater_than_max_is_422(self, client):
        response = client.get(URL, params={"min_price_cents": 10, "max_price_cents": 9})
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "params",
        [
            {"min_price_cents": -1},
            {"page": 0},
            {"page_size": 0},
            {"page_size": 51},
            {"sort": "cheapest"},
            {"in_stock": "maybe"},
            {"min_price_cents": "abc"},
            {"colour": "red"},  # unknown parameter
        ],
    )
    def test_invalid_parameters_are_422(self, client, params):
        response = client.get(URL, params=params)
        assert response.status_code == 422
        assert error_code(response) == "validation_error"

    def test_in_stock_excludes_the_three_out_of_stock_products(self, client):
        body = get(client, in_stock="true", page_size=50).json()
        assert body["total"] == 57
        assert not {"KIT-009", "BTH-008", "STR-010"} & set(skus(get(client, in_stock="true")))

    def test_filters_combine(self, client):
        params = dict(category="kitchen", q="steel", max_price_cents=3000, in_stock="true")
        expected = expected_page(category="kitchen", q="steel", max_price=3000, in_stock=True)
        assert skus(get(client, **params)) == expected["skus"]


class TestSort:
    @pytest.mark.parametrize("sort", ["name", "price_asc", "price_desc", "newest", "rating"])
    def test_every_sort_matches_oracle_on_every_page(self, client, sort):
        for page in (1, 2, 3):
            assert skus(get(client, sort=sort, page=page)) == expected_page(sort, page)["skus"]

    def test_name_sort_is_locale_independent(self, db):
        """Regression (caught by CI): name order used to follow the server's locale.

        The seed names really do sort differently under a linguistic collation, so if
        COLLATE "C" were dropped this suite would fail on any en_US server (like CI's).
        """
        from sqlalchemy import select, text

        from app.models import Product
        from app.services.catalog import _ORDER_BY, ProductSort

        # ICU "ka-shifted" ignores spaces/punctuation like glibc's en_US.utf8 (CI's default).
        # Created inside the test transaction, so it's rolled back afterwards.
        db.execute(
            text(
                "CREATE COLLATION IF NOT EXISTS test_en_shifted "
                "(provider = icu, locale = 'en-US-u-ka-shifted')"
            )
        )
        linguistic = db.scalars(
            select(Product.sku)
            .where(Product.is_archived.is_(False))
            .order_by(text("lower(name) COLLATE test_en_shifted"), Product.id)
        ).all()
        assert linguistic != expected_page("name", page_size=60)["skus"]

        compiled = str(select(Product.id).order_by(*_ORDER_BY[ProductSort.NAME]))
        assert 'COLLATE "C"' in compiled

    def test_unrated_products_sort_last(self, client):
        last_page = get(client, sort="rating", page=3).json()["items"]
        assert last_page[-1]["rating_avg"] is None
        assert last_page[-1]["rating_count"] == 0

    def test_price_desc_starts_with_most_expensive(self, client):
        top = get(client, sort="price_desc").json()["items"][0]
        assert top["price_cents"] == max(p.price_cents for p in ACTIVE)


class TestStockFields:
    """CAT-05: status everywhere, exact count only when 5 or fewer."""

    @pytest.mark.parametrize(
        ("sku", "status", "left"),
        [
            ("KIT-009", "out_of_stock", None),  # 0
            ("CLN-005", "low_stock", 1),  # 1
            ("KIT-005", "low_stock", 5),  # 5 - boundary
            ("CLN-008", "in_stock", None),  # 6 - boundary + 1
            ("CLN-001", "in_stock", None),  # 150
        ],
    )
    def test_stock_status_on_list(self, client, sku, status, left):
        [item] = [p for p in get(client, q=_name(sku)).json()["items"] if p["sku"] == sku]
        assert (item["stock_status"], item["stock_left"]) == (status, left)

    def test_exact_stock_never_leaks_for_well_stocked_items(self, client):
        for page in (1, 2, 3):
            for item in get(client, page=page).json()["items"]:
                assert "stock_qty" not in item
                if item["stock_status"] == "in_stock":
                    assert item["stock_left"] is None


def _name(sku):
    return next(p.name for p in ACTIVE if p.sku == sku).split()[0]


class TestCategories:
    def test_counts_exclude_archived(self, client):
        categories = client.get("/api/v1/categories").json()
        names = [c["name"] for c in categories]
        assert names == sorted(names)
        assert {c["slug"]: c["product_count"] for c in categories} == {
            "bath": 10,
            "cleaning": 10,
            "kitchen": 10,  # KIT-900 is archived
            "laundry": 10,
            "paper-goods": 10,
            "storage": 10,
        }


class TestDetail:
    def test_detail(self, client):
        body = client.get(f"{URL}/chef-s-knife-8in").json()
        assert body["sku"] == "KIT-006"
        assert body["price_cents"] == 4999
        assert body["category"] == {"slug": "kitchen", "name": "Kitchen"}
        assert body["description"] == "High-carbon stainless steel blade."
        assert body["max_order_qty"] == 10
        assert body["images"] == []

    @pytest.mark.parametrize(("slug", "cap"), [("glass-cleaner-26oz", 1), ("dish-drying-rack", 0)])
    def test_max_order_qty_limited_by_stock(self, client, slug, cap):
        assert client.get(f"{URL}/{slug}").json()["max_order_qty"] == cap

    @pytest.mark.parametrize("slug", ["discontinued-toaster", "no-such-thing"])
    def test_archived_or_unknown_is_404(self, client, slug):
        response = client.get(f"{URL}/{slug}")
        assert response.status_code == 404
        assert error_code(response) == "product_not_found"


# --- Model-based property test -------------------------------------------------------------

CATEGORY_SLUGS = ["kitchen", "cleaning", "bath", "laundry", "storage", "paper-goods"]
WORDS = ["towel", "steel", "set", "pk", "paper", "bag", "clean", "cotton", "zzz", "Glass"]


@settings(
    max_examples=40,
    deadline=None,  # network DB: latency varies
    suppress_health_check=[HealthCheck.function_scoped_fixture],  # read-only queries
)
@given(
    category=st.none() | st.sampled_from(CATEGORY_SLUGS),
    q=st.none() | st.lists(st.sampled_from(WORDS), min_size=1, max_size=2).map(" ".join),
    prices=st.tuples(st.none() | st.integers(0, 6000), st.none() | st.integers(0, 6000)).filter(
        lambda p: None in p or p[0] <= p[1]
    ),
    in_stock=st.booleans(),
    sort=st.sampled_from(["name", "price_asc", "price_desc", "newest", "rating"]),
    page=st.integers(1, 4),
    page_size=st.sampled_from([1, 7, 20, 50]),
)
def test_any_query_matches_the_oracle(client, category, q, prices, in_stock, sort, page, page_size):
    min_price, max_price = prices
    response = get(
        client,
        category=category,
        q=q,
        min_price_cents=min_price,
        max_price_cents=max_price,
        in_stock=str(in_stock).lower(),
        sort=sort,
        page=page,
        page_size=page_size,
    )
    expected = expected_page(
        sort,
        page,
        page_size,
        category=category,
        q=q,
        min_price=min_price,
        max_price=max_price,
        in_stock=in_stock,
    )
    body = response.json()
    assert skus(response) == expected["skus"]
    assert (body["total"], body["pages"]) == (expected["total"], expected["pages"])
