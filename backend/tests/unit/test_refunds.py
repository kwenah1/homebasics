"""RET-04 refund maths - properties that must hold for any order and any way of splitting
its returns."""

from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.models import ShippingMethod
from app.services.pricing import price_order
from app.services.refunds import cumulative_refund, goods_paid, refund_for_return


def test_worked_example():
    """$60 of goods, $6 off, 8.25% tax on $54 = $4.46 -> goods paid $58.46.
    Returning the $20 item refunds a third of that, rounded down: $19.48."""
    totals = price_order([2000, 4000], Decimal("0.0825"), ShippingMethod.STANDARD, 600)
    paid = goods_paid(totals.total_cents, totals.shipping_cents)
    assert paid == 5846
    assert refund_for_return(paid, 6000, 0, 2000) == 1948
    assert refund_for_return(paid, 6000, 2000, 4000) == 5846 - 1948  # the rest, exactly


def test_nothing_returned_nothing_refunded():
    assert cumulative_refund(5000, 5000, 0) == 0


def test_no_subtotal_no_refund():
    assert cumulative_refund(0, 0, 100) == 0


orders = st.lists(st.integers(1, 20_000), min_size=1, max_size=6).flatmap(
    lambda lines: st.tuples(
        st.just(lines),
        st.integers(0, sum(lines)),  # discount
        st.sampled_from([Decimal("0"), Decimal("0.0625"), Decimal("0.0825"), Decimal("0.1")]),
        st.permutations(range(len(lines))),  # the order the lines come back in
        st.integers(1, len(lines)),  # how many returns the lines are split into
    )
)


@given(orders)
def test_split_returns_never_refund_more_than_was_paid(order):
    lines, discount, rate, sequence, chunks = order
    totals = price_order(lines, rate, ShippingMethod.STANDARD, discount)
    paid = goods_paid(totals.total_cents, totals.shipping_cents)
    subtotal = totals.subtotal_cents

    returned, refunds = 0, []
    size = -(-len(sequence) // chunks)  # ceil
    for start in range(0, len(sequence), size):
        value = sum(lines[i] for i in sequence[start : start + size])
        refunds.append(refund_for_return(paid, subtotal, returned, value))
        returned += value

    assert all(r >= 0 for r in refunds)
    assert sum(refunds) == paid  # everything back: exactly what was paid for goods
    assert paid <= totals.total_cents  # shipping is never refunded


@given(
    paid=st.integers(0, 1_000_000),
    subtotal=st.integers(1, 1_000_000),
    a=st.integers(0, 1_000_000),
    b=st.integers(0, 1_000_000),
)
def test_refund_grows_with_what_comes_back(paid, subtotal, a, b):
    low, high = sorted((a, b))
    assert cumulative_refund(paid, subtotal, low) <= cumulative_refund(paid, subtotal, high)
    assert cumulative_refund(paid, subtotal, high) <= paid


@pytest.mark.parametrize(("value", "expected"), [(1, 0), (2, 1), (3, 2)])
def test_rounding_is_down_until_the_last_item(value, expected):
    """paid 2 over subtotal 3: 2/3 -> 0, 4/3 -> 1, then the last return completes it."""
    assert cumulative_refund(2, 3, value) == expected
