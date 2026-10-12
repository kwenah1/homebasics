"""CPN-02: discount maths and coupon state - pure rules, no database."""

from datetime import timedelta
from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.core import clock
from app.models import Coupon, CouponKind, ShippingMethod
from app.services.coupons import discount_for, state_of
from app.services.pricing import price_order


def percent(pct: int, **fields) -> Coupon:
    return Coupon(kind=CouponKind.PERCENT, percent_off=pct, **{"is_active": True, **fields})


def fixed(cents: int, **fields) -> Coupon:
    return Coupon(kind=CouponKind.FIXED, amount_off_cents=cents, **{"is_active": True, **fields})


@pytest.mark.parametrize(
    ("subtotal", "pct", "expected"),
    [
        (1000, 10, 100),
        (4999, 10, 500),  # 499.9 -> 500 (half-up)
        (4995, 10, 500),  # 499.5 -> 500 (exactly half rounds up)
        (4994, 10, 499),  # 499.4 -> 499
        (1, 50, 1),  # 0.5 cent rounds up
        (1, 49, 0),  # 0.49 cent rounds down
        (2599, 100, 2599),  # 100% makes the goods free
    ],
)
def test_percent_rounds_half_up_to_the_cent(subtotal, pct, expected):
    assert discount_for(percent(pct), subtotal) == expected


@pytest.mark.parametrize(("subtotal", "expected"), [(3000, 500), (500, 500), (499, 499), (0, 0)])
def test_fixed_never_exceeds_the_subtotal(subtotal, expected):
    assert discount_for(fixed(500), subtotal) == expected


@given(
    lines=st.lists(st.integers(0, 50_000), min_size=1, max_size=10),
    coupon=st.one_of(st.integers(1, 100).map(percent), st.integers(1, 100_000).map(fixed)),
    method=st.sampled_from(list(ShippingMethod)),
)
def test_total_is_never_negative_and_adds_up(lines, coupon, method):
    """CPN: 'total never below $0' - and the parts always add up to the total."""
    subtotal = sum(lines)
    discount = discount_for(coupon, subtotal)
    assert 0 <= discount <= subtotal
    totals = price_order(lines, Decimal("0.0825"), method, discount)
    assert totals.total_cents >= 0
    assert totals.total_cents == (
        totals.subtotal_cents - totals.discount_cents + totals.tax_cents + totals.shipping_cents
    )


def test_free_shipping_uses_the_discounted_subtotal():
    """CHK-03 + CPN: $55 of goods with $10 off is $45 - under $50, so shipping is charged."""
    totals = price_order([5500], Decimal(0), ShippingMethod.STANDARD, 1000)
    assert totals.shipping_cents == 599


class TestState:
    @pytest.fixture(autouse=True)
    def _frozen(self, frozen_clock):
        self.now = clock.now()

    def test_active(self):
        assert state_of(percent(10), uses=0) == "active"

    def test_disabled_wins(self):
        assert state_of(percent(10, is_active=False), uses=0) == "disabled"
        c = percent(10)
        c.is_active = False
        c.expires_at = self.now - timedelta(days=1)
        assert state_of(c, uses=0) == "disabled"

    def test_scheduled_until_the_start(self):
        c = percent(10, starts_at=self.now + timedelta(seconds=1))
        assert state_of(c, uses=0) == "scheduled"
        c.starts_at = self.now
        assert state_of(c, uses=0) == "active"

    def test_expires_at_the_exact_second(self):
        c = percent(10, expires_at=self.now + timedelta(seconds=1))
        assert state_of(c, uses=0) == "active"
        c.expires_at = self.now
        assert state_of(c, uses=0) == "expired"

    def test_exhausted_at_the_limit(self):
        c = percent(10, max_redemptions=3)
        assert state_of(c, uses=2) == "active"
        assert state_of(c, uses=3) == "exhausted"
