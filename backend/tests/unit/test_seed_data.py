"""Guards on the seed data that later tests (and E2E suites) depend on."""

from collections import Counter

from app.seed import data
from app.seed.run import slugify

ACTIVE = data.PRODUCTS
ALL = data.PRODUCTS + data.ARCHIVED_PRODUCTS


def test_sixty_active_products_ten_per_category():
    assert len(ACTIVE) == 60
    per_category = Counter(p[0] for p in ACTIVE)
    assert set(per_category) == {slug for _, slug, _ in data.CATEGORIES}
    assert set(per_category.values()) == {10}


def test_skus_and_slugs_are_unique():
    skus = [p[1] for p in ALL]
    slugs = [slugify(p[2]) for p in ALL]
    assert len(set(skus)) == len(skus)
    assert len(set(slugs)) == len(slugs)


def test_prices_positive_and_stock_non_negative():
    assert all(p[3] > 0 for p in ALL)
    assert all(p[4] >= 0 for p in ALL)


def test_boundary_values_present_for_stock_rules():
    """CAT-05: 0 = out of stock, 1..5 = 'Only X left', 6 = just above threshold."""
    stocks = {p[4] for p in ACTIVE}
    assert {0, 1, 5, 6} <= stocks


def test_boundary_values_present_for_free_shipping():
    """CHK-03: one item just under and one exactly at the $50.00 threshold."""
    prices = {p[3] for p in ACTIVE}
    assert {4999, 5000} <= prices


def test_tax_table_covers_50_states_plus_dc():
    codes = [code for code, _, _ in data.TAX_RATES]
    assert len(codes) == 51
    assert len(set(codes)) == 51
    assert dict((c, r) for c, _, r in data.TAX_RATES)["TX"] == data.Decimal("0.0825")


def test_every_seed_user_has_a_password():
    assert {u["email"] for u in data.USERS} == set(data.SEED_PASSWORDS)
    assert {u["role"] for u in data.USERS} == {"admin", "customer"}


def test_slugify():
    assert slugify("Chef's Knife 8in") == "chef-s-knife-8in"
    assert slugify("  Paper Towels (12 Double Rolls) ") == "paper-towels-12-double-rolls"
