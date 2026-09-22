"""CHK-01/02/03/05 pricing - worked examples, boundaries and properties."""

from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.models import ShippingMethod
from app.services.pricing import price_order, shipping_for, tax_on

TX = Decimal("0.0825")
STD, EXP = ShippingMethod.STANDARD, ShippingMethod.EXPRESS


def test_worked_example_texas_standard():
    """2 x $24.99 pan to Texas: $49.98 + $4.12 tax + $5.99 shipping = $60.09."""
    t = price_order([4998], TX, STD)
    assert (t.subtotal_cents, t.tax_cents, t.shipping_cents, t.total_cents) == (
        4998,
        412,
        599,
        6009,
    )


def test_zero_tax_state():
    t = price_order([4998], Decimal("0"), STD)
    assert (t.tax_cents, t.total_cents) == (0, 4998 + 599)


@pytest.mark.parametrize(
    ("subtotal", "method", "shipping"),
    [
        (4999, STD, 599),  # $49.99 - one cent short
        (5000, STD, 0),  # $50.00 - free
        (5001, STD, 0),
        (0, STD, 599),
        (4999, EXP, 1499),  # express is never free
        (5000, EXP, 1499),
        (99999, EXP, 1499),
    ],
)
def test_shipping_boundaries(subtotal, method, shipping):
    """CHK-03"""
    assert shipping_for(method, subtotal) == shipping


def test_free_shipping_uses_the_discounted_subtotal():
    """$52 cart with a $3 discount is $49 - so standard shipping is charged."""
    assert price_order([5200], TX, STD, discount_cents=300).shipping_cents == 599


def test_tax_is_on_discounted_subtotal_and_never_on_shipping():
    t = price_order([10000], TX, EXP, discount_cents=2000)
    assert t.tax_cents == tax_on(8000, TX) == 660
    assert t.total_cents == 8000 + 660 + 1499


@pytest.mark.parametrize(
    ("taxable", "rate", "tax"),
    [
        (10, Decimal("0.05"), 1),  # 0.5 cent rounds UP (half-up, not banker's rounding)
        (30, Decimal("0.05"), 2),  # 1.5 -> 2
        (50, Decimal("0.05"), 3),  # 2.5 -> 3 (banker's would give 2)
        (9, Decimal("0.05"), 0),  # 0.45 -> 0
        (4998, TX, 412),  # 412.335 -> 412
        (1, TX, 0),
    ],
)
def test_tax_rounding_half_up(taxable, rate, tax):
    """CHK-05: rounded once, half-up."""
    assert tax_on(taxable, rate) == tax


def test_rounding_happens_once_on_the_order_not_per_line():
    """Three lines of $0.10 at 5%: per-line rounding would give 3 x 1 = 3 cents; the rule is
    one rounding on the order subtotal: 30 x 5% = 1.5 -> 2 cents."""
    assert price_order([10, 10, 10], Decimal("0.05"), STD).tax_cents == 2


def test_discount_never_takes_subtotal_below_zero():
    t = price_order([1000], TX, STD, discount_cents=5000)
    assert (t.discount_cents, t.tax_cents) == (1000, 0)
    assert t.total_cents == 599


@pytest.mark.parametrize(
    "kwargs",
    [
        {"line_totals_cents": [-1]},
        {"line_totals_cents": [100], "discount_cents": -5},
        {"line_totals_cents": [100], "tax_rate": Decimal("-0.01")},
    ],
)
def test_negative_inputs_are_rejected(kwargs):
    args = {"tax_rate": TX, "method": STD, **kwargs}
    with pytest.raises(ValueError):
        price_order(**args)


@given(
    lines=st.lists(st.integers(0, 50_000), max_size=10),
    rate=st.decimals(min_value=0, max_value=Decimal("0.15"), places=5),
    method=st.sampled_from(list(ShippingMethod)),
    discount=st.integers(0, 100_000),
)
def test_properties(lines, rate, method, discount):
    t = price_order(lines, rate, method, discount_cents=discount)
    # The same identity the database enforces with a CHECK constraint.
    assert t.total_cents == t.subtotal_cents - t.discount_cents + t.tax_cents + t.shipping_cents
    assert t.total_cents >= 0
    assert 0 <= t.discount_cents <= t.subtotal_cents
    assert t.tax_cents >= 0
    # Tax never exceeds the rate applied to the taxable amount, by more than half a cent.
    assert abs(t.tax_cents - (t.subtotal_cents - t.discount_cents) * rate) <= Decimal("0.5")
    assert t.shipping_cents in {0, 599, 1499}
