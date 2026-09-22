"""Pure cart rules - no database."""

from types import SimpleNamespace

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.schemas.cart import GuestItem
from app.services.cart import (
    amount_to_free_shipping,
    combine_guest_items,
    line_issue,
    line_limit,
    merged_quantity,
)


def product(stock=20, archived=False):
    return SimpleNamespace(stock_qty=stock, is_archived=archived)


@pytest.mark.parametrize(("stock", "limit"), [(0, 0), (1, 1), (9, 9), (10, 10), (11, 10), (99, 10)])
def test_line_limit(stock, limit):
    """CRT-01: min(10, stock)."""
    assert line_limit(stock) == limit


@pytest.mark.parametrize(
    ("stock", "archived", "qty", "expected"),
    [
        (20, False, 3, (None, None)),
        (3, False, 3, (None, None)),  # boundary: exactly enough
        (2, False, 3, ("insufficient_stock", 2)),
        (0, False, 1, ("out_of_stock", None)),
        (20, True, 1, ("unavailable", None)),  # archived wins over everything
        (0, True, 1, ("unavailable", None)),
    ],
)
def test_line_issue(stock, archived, qty, expected):
    """CRT-04: nothing reserved, so each line is re-checked against today's stock."""
    assert line_issue(product(stock, archived), qty) == expected


@pytest.mark.parametrize(
    ("existing", "incoming", "stock", "kept"),
    [
        (0, 3, 20, 3),
        (2, 3, 20, 5),  # summed
        (6, 6, 20, 10),  # capped at 10
        (2, 5, 4, 4),  # capped at stock
        (7, 1, 5, 7),  # stock fell below existing: never reduced by a merge
        (10, 1, 20, 10),
    ],
)
def test_merged_quantity(existing, incoming, stock, kept):
    """CRT-02"""
    assert merged_quantity(existing, incoming, stock) == kept


@given(
    existing=st.integers(0, 10),
    incoming=st.integers(1, 10),
    stock=st.integers(1, 50),
)
def test_merged_quantity_properties(existing, incoming, stock):
    kept = merged_quantity(existing, incoming, stock)
    assert kept >= existing  # a merge never takes items away
    assert kept <= existing + incoming  # ...and never invents them
    assert kept <= max(existing, min(10, stock))  # limit respected for anything it adds


@pytest.mark.parametrize(
    ("subtotal", "gap"), [(0, 5000), (4999, 1), (5000, 0), (5001, 0), (12000, 0)]
)
def test_amount_to_free_shipping(subtotal, gap):
    """CHK-03 boundary: $49.99 is 1 cent short; $50.00 qualifies."""
    assert amount_to_free_shipping(subtotal) == gap


def test_combine_guest_items_sums_duplicates_and_keeps_first_price():
    items = [
        GuestItem(product_id=5, quantity=2, price_cents_seen=100),
        GuestItem(product_id=9, quantity=1),
        GuestItem(product_id=5, quantity=3, price_cents_seen=150),
    ]
    assert list(combine_guest_items(items).items()) == [(5, (5, 100)), (9, (1, None))]
