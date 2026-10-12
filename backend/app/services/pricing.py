"""Order pricing: CHK-01, 02, 03, 05. Pure functions only - no database, no clock.

Calculation order (CHK-01): subtotal -> discount -> tax -> shipping -> total.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.core import bugs
from app.models import ShippingMethod

FREE_SHIPPING_THRESHOLD_CENTS = 5000  # CHK-03: $50.00, compared with the discounted subtotal
STANDARD_SHIPPING_CENTS = 599
EXPRESS_SHIPPING_CENTS = 1499


@dataclass(frozen=True)
class Totals:
    subtotal_cents: int
    discount_cents: int
    tax_rate: Decimal
    tax_cents: int
    shipping_cents: int
    total_cents: int


def tax_on(taxable_cents: int, rate: Decimal) -> int:
    """CHK-05: tax is rounded once, half-up, to whole cents (0.5 cent rounds up)."""
    return int((Decimal(taxable_cents) * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def shipping_for(method: ShippingMethod, discounted_subtotal_cents: int) -> int:
    """CHK-03: standard is free from $50.00 (after discount); express is always $14.99."""
    if method == ShippingMethod.EXPRESS:
        return EXPRESS_SHIPPING_CENTS
    if bugs.active("free_shipping_off_by_one"):
        return (
            0
            if discounted_subtotal_cents > FREE_SHIPPING_THRESHOLD_CENTS
            else STANDARD_SHIPPING_CENTS
        )
    if discounted_subtotal_cents >= FREE_SHIPPING_THRESHOLD_CENTS:
        return 0
    return STANDARD_SHIPPING_CENTS


def price_order(
    line_totals_cents: list[int],
    tax_rate: Decimal,
    method: ShippingMethod,
    discount_cents: int = 0,
) -> Totals:
    if any(t < 0 for t in line_totals_cents) or discount_cents < 0 or tax_rate < 0:
        raise ValueError("amounts and rates must not be negative")
    subtotal = sum(line_totals_cents)
    discount = min(discount_cents, subtotal)  # CPN: a discount never takes the total below $0
    discounted = subtotal - discount
    tax = tax_on(discounted, tax_rate)  # CHK-02: never on shipping
    if bugs.active("tax_rounds_per_line"):
        tax = sum(tax_on(t, tax_rate) for t in line_totals_cents) - tax_on(discount, tax_rate)
    shipping = shipping_for(method, discounted)
    if bugs.active("tax_on_shipping"):
        tax = tax_on(discounted + shipping, tax_rate)
    return Totals(
        subtotal_cents=subtotal,
        discount_cents=discount,
        tax_rate=tax_rate,
        tax_cents=tax,
        shipping_cents=shipping,
        total_cents=discounted + tax + shipping,
    )
