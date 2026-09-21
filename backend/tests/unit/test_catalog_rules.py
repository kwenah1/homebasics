"""Pure catalog rules - no database."""

import pytest

from app.services.catalog import (
    escape_like,
    max_order_qty,
    page_count,
    search_terms,
    stock_status,
)


@pytest.mark.parametrize(
    ("qty", "expected"),
    [
        (0, ("out_of_stock", None)),
        (-3, ("out_of_stock", None)),  # defensive: never negative in the DB
        (1, ("low_stock", 1)),
        (5, ("low_stock", 5)),  # boundary: threshold is inclusive
        (6, ("in_stock", None)),  # boundary + 1: exact count hidden
        (150, ("in_stock", None)),
    ],
)
def test_stock_status_boundaries(qty, expected):
    """CAT-05"""
    assert stock_status(qty) == expected


@pytest.mark.parametrize(("stock", "cap"), [(0, 0), (1, 1), (9, 9), (10, 10), (11, 10), (500, 10)])
def test_max_order_qty_caps_at_ten_and_stock(stock, cap):
    assert max_order_qty(stock) == cap


@pytest.mark.parametrize(
    ("q", "terms"),
    [
        (None, []),
        ("", []),
        ("   ", []),
        ("towel", ["towel"]),
        ("  bath   towel ", ["bath", "towel"]),
        ("a b c d e f g h i j", ["a", "b", "c", "d", "e", "f", "g", "h"]),  # max 8 terms
    ],
)
def test_search_terms(q, terms):
    assert search_terms(q) == terms


@pytest.mark.parametrize(
    ("raw", "escaped"),
    [("100%", "100\\%"), ("a_b", "a\\_b"), ("back\\slash", "back\\\\slash"), ("plain", "plain")],
)
def test_escape_like(raw, escaped):
    assert escape_like(raw) == escaped


@pytest.mark.parametrize(
    ("total", "size", "pages"), [(0, 20, 0), (1, 20, 1), (20, 20, 1), (21, 20, 2), (60, 20, 3)]
)
def test_page_count(total, size, pages):
    assert page_count(total, size) == pages
