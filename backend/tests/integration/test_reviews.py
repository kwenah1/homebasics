"""REV-01..05: who may review, one review per product per shopper, the rating bookkeeping, and
moderation (ADM-06)."""

from decimal import ROUND_HALF_UP, Decimal

import pytest
from hypothesis import HealthCheck, settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule
from sqlalchemy import select

from app.models import Product
from tests.helpers import error_code
from tests.integration.checkout_support import add, deliver, order_row, place

ADMIN_REVIEWS = "/api/v1/admin/reviews"


def reviews_url(product) -> str:
    return f"/api/v1/products/{product.slug}/reviews"


def expected_avg(total: int, count: int) -> float | None:
    if count == 0:
        return None
    return float((Decimal(total) / count).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def rating_of(db, product) -> tuple[int, int, float | None]:
    db.refresh(product)
    avg = float(product.rating_avg) if product.rating_avg is not None else None
    return product.rating_count, product.rating_total, avg


@pytest.fixture
def unrated(db):
    """A visible product nobody has rated yet (every 7th seed product)."""
    return db.scalar(
        select(Product)
        .where(Product.rating_count == 0, Product.is_archived.is_(False))
        .order_by(Product.id)
    )


@pytest.fixture
def buyer(client, customer, db):
    """The signed-in customer, with a delivered order of the given product."""
    user = customer

    def _bought(product, status="delivered"):
        order_row(db, user, product, status)
        return user

    return _bought


class TestEligibility:
    def test_not_purchased(self, client, customer, products):
        pan = products["KIT-001"]
        mine = client.get(f"{reviews_url(pan)}/mine").json()
        assert mine == {"can_review": False, "reason": "not_purchased", "review": None}
        r = client.post(reviews_url(pan), json={"rating": 5})
        assert (r.status_code, error_code(r)) == (403, "review_not_allowed")

    @pytest.mark.parametrize(
        "status", ["pending_payment", "paid", "processing", "shipped", "cancelled", "refunded"]
    )
    def test_only_a_delivered_order_counts(self, client, buyer, products, status):
        pan = products["KIT-001"]
        buyer(pan, status)
        assert client.post(reviews_url(pan), json={"rating": 5}).status_code == 403

    def test_delivered_order_through_the_real_journey(
        self, client, address, products, admin_headers
    ):
        pan = products["KIT-001"]
        add(client, pan)
        number = place(client, address).json()["order_number"]
        assert client.get(f"{reviews_url(pan)}/mine").json()["can_review"] is False
        deliver(client, number, admin_headers)
        assert client.get(f"{reviews_url(pan)}/mine").json() == {
            "can_review": True,
            "reason": None,
            "review": None,
        }
        assert client.post(reviews_url(pan), json={"rating": 4}).status_code == 201

    def test_another_product_on_the_same_order_does_not_count(self, client, buyer, products):
        buyer(products["KIT-001"])
        assert client.post(reviews_url(products["CLN-001"]), json={"rating": 5}).status_code == 403

    def test_someone_elses_delivery_does_not_count(self, client, customer, make_user, db, products):
        other, _ = make_user()
        order_row(db, other, products["KIT-001"])
        assert client.post(reviews_url(products["KIT-001"]), json={"rating": 5}).status_code == 403

    def test_signed_out_can_read_but_not_write(self, client, products):
        pan = products["KIT-001"]
        assert client.get(reviews_url(pan)).status_code == 200
        assert client.get(f"{reviews_url(pan)}/mine").status_code == 401
        assert client.post(reviews_url(pan), json={"rating": 5}).status_code == 401

    def test_archived_product_is_404(self, client, db, customer):
        archived = db.scalar(select(Product).where(Product.is_archived.is_(True)))
        assert client.get(reviews_url(archived)).status_code == 404


class TestWriting:
    def test_create_updates_the_rating(self, client, db, buyer, unrated):
        buyer(unrated)
        r = client.post(
            reviews_url(unrated), json={"rating": 4, "title": " Great ", "body": "Works well."}
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert (body["rating"], body["title"], body["body"], body["verified_purchase"]) == (
            4,
            "Great",
            "Works well.",
            True,
        )
        assert rating_of(db, unrated) == (1, 4, 4.0)

    def test_one_review_per_product(self, client, buyer, unrated):
        buyer(unrated)
        assert client.post(reviews_url(unrated), json={"rating": 4}).status_code == 201
        r = client.post(reviews_url(unrated), json={"rating": 5})
        assert (r.status_code, error_code(r)) == (409, "review_exists")
        assert client.get(f"{reviews_url(unrated)}/mine").json()["reason"] == "already_reviewed"

    def test_author_is_first_name_and_initial_only(self, client, db, buyer, unrated):
        user = buyer(unrated)
        body = client.post(reviews_url(unrated), json={"rating": 5}).json()
        assert body["author"] == f"{user.first_name} {user.last_name[0]}."
        assert user.email not in str(body)

    def test_edit_rating_moves_the_average(self, client, db, buyer, unrated):
        buyer(unrated)
        client.post(reviews_url(unrated), json={"rating": 2})
        r = client.patch(f"{reviews_url(unrated)}/mine", json={"rating": 5})
        assert r.json()["rating"] == 5
        assert rating_of(db, unrated) == (1, 5, 5.0)

    def test_edit_text_only_leaves_the_rating(self, client, db, buyer, unrated):
        buyer(unrated)
        client.post(reviews_url(unrated), json={"rating": 3, "title": "Old"})
        r = client.patch(f"{reviews_url(unrated)}/mine", json={"title": "New", "body": ""})
        assert (r.json()["title"], r.json()["body"], r.json()["rating"]) == ("New", None, 3)
        assert rating_of(db, unrated) == (1, 3, 3.0)

    def test_delete_restores_the_numbers_exactly(self, client, db, buyer, products):
        pan = products["KIT-001"]  # seeded with older ratings
        before = rating_of(db, pan)
        buyer(pan)
        client.post(reviews_url(pan), json={"rating": 1})
        assert rating_of(db, pan)[:2] == (before[0] + 1, before[1] + 1)
        assert client.delete(f"{reviews_url(pan)}/mine").status_code == 204
        count, total, avg = rating_of(db, pan)
        assert (count, total) == before[:2]
        assert avg == expected_avg(total, count)

    def test_last_review_deleted_means_unrated_again(self, client, db, buyer, unrated):
        buyer(unrated)
        client.post(reviews_url(unrated), json={"rating": 5})
        client.delete(f"{reviews_url(unrated)}/mine")
        assert rating_of(db, unrated) == (0, 0, None)

    def test_editing_or_deleting_without_a_review_is_404(self, client, customer, products):
        url = f"{reviews_url(products['KIT-001'])}/mine"
        assert client.patch(url, json={"rating": 3}).status_code == 404
        assert client.delete(url).status_code == 404

    @pytest.mark.parametrize(
        "body",
        [
            {"rating": 0},
            {"rating": 6},
            {"rating": 4.5},
            {},
            {"rating": 5, "title": "x" * 101},
            {"rating": 5, "body": "x" * 2001},
            {"rating": 5, "user_id": 1},  # mass assignment
        ],
    )
    def test_invalid_reviews_are_422(self, client, buyer, unrated, body):
        buyer(unrated)
        assert client.post(reviews_url(unrated), json=body).status_code == 422

    def test_rating_cannot_be_cleared(self, client, buyer, unrated):
        buyer(unrated)
        client.post(reviews_url(unrated), json={"rating": 5})
        assert (
            client.patch(f"{reviews_url(unrated)}/mine", json={"rating": None}).status_code == 422
        )


class TestReading:
    def test_newest_first_with_distribution(self, client, db, make_user, auth_as, unrated):
        for stars in (5, 3, 5):
            user, password = make_user()
            order_row(db, user, unrated)
            auth_as(user.email, password)
            assert client.post(reviews_url(unrated), json={"rating": stars}).status_code == 201
        page = client.get(reviews_url(unrated), params={"page_size": 2}).json()
        assert [r["rating"] for r in page["items"]] == [5, 3]  # newest two
        assert (page["total"], page["rating_count"], page["rating_avg"]) == (3, 3, 4.3)
        assert page["distribution"] == {"1": 0, "2": 0, "3": 1, "4": 0, "5": 2}

    def test_product_page_shows_the_new_rating(self, client, db, buyer, unrated):
        buyer(unrated)
        client.post(reviews_url(unrated), json={"rating": 4})
        detail = client.get(f"/api/v1/products/{unrated.slug}").json()
        assert (detail["rating_avg"], detail["rating_count"]) == (4.0, 1)


class TestModeration:
    def test_admin_lists_and_removes_a_review(self, client, db, buyer, unrated, admin_headers):
        user = buyer(unrated)
        client.post(reviews_url(unrated), json={"rating": 1, "title": "Spam spam"})
        listed = client.get(ADMIN_REVIEWS, headers=admin_headers).json()
        mine = next(r for r in listed["items"] if r["product_id"] == unrated.id)
        assert (mine["author_email"], mine["product_slug"]) == (user.email, unrated.slug)
        r = client.delete(f"{ADMIN_REVIEWS}/{mine['id']}", headers=admin_headers)
        assert r.status_code == 204
        assert rating_of(db, unrated) == (0, 0, None)
        assert client.get(reviews_url(unrated)).json()["total"] == 0

    def test_unknown_review_is_404(self, client, admin_headers):
        assert client.delete(f"{ADMIN_REVIEWS}/999999", headers=admin_headers).status_code == 404


# --- Model-based: any sequence of writes keeps the rating exact (REV-03) ------------------


@pytest.fixture
def rating_machine(client, db, make_user, auth_as, products):
    product = products["KIT-001"]
    db.refresh(product)
    baseline = (product.rating_count, product.rating_total)
    shoppers = []
    for _ in range(3):
        user, password = make_user()
        order_row(db, user, product)
        shoppers.append((user, password))
    url = reviews_url(product)

    class RatingMachine(RuleBasedStateMachine):
        def __init__(self):
            super().__init__()
            self.model: dict[int, int] = {}  # shopper index -> stars
            for i in range(len(shoppers)):
                self._as(i)
                client.delete(f"{url}/mine")  # start clean for each example

        def _as(self, i):
            auth_as(shoppers[i][0].email, shoppers[i][1])

        @rule(i=st.integers(0, 2), stars=st.integers(1, 5))
        def create(self, i, stars):
            self._as(i)
            r = client.post(url, json={"rating": stars})
            if i in self.model:
                assert r.status_code == 409
            else:
                assert r.status_code == 201, r.text
                self.model[i] = stars

        @rule(i=st.integers(0, 2), stars=st.integers(1, 5))
        def edit(self, i, stars):
            self._as(i)
            r = client.patch(f"{url}/mine", json={"rating": stars})
            assert r.status_code == (200 if i in self.model else 404)
            if i in self.model:
                self.model[i] = stars

        @rule(i=st.integers(0, 2))
        def delete(self, i):
            self._as(i)
            r = client.delete(f"{url}/mine")
            assert r.status_code == (204 if i in self.model else 404)
            self.model.pop(i, None)

        @invariant()
        def rating_matches_the_model(self):
            count = baseline[0] + len(self.model)
            total = baseline[1] + sum(self.model.values())
            assert rating_of(db, product) == (count, total, expected_avg(total, count))

    return RatingMachine


def test_rating_bookkeeping_is_exact(rating_machine):
    rating_machine.TestCase.settings = settings(
        max_examples=15,
        stateful_step_count=12,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
    )
    rating_machine.TestCase().runTest()
