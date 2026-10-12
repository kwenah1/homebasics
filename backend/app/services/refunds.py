"""Refund maths for returns (RET-04). Pure functions - no database, no clock.

A return refunds the returned goods' share of what was actually paid for goods: the discount
is shared out pro rata and tax comes back with the goods; shipping is not refunded.

The share is computed *cumulatively* over the order, not per return:

    refunded after k returns = floor(goods_paid * value_returned_so_far / subtotal)

and the k-th refund is the difference from the previous value. Rounding per return could
drift a cent each time; this way the refunds for an order can never add up to more than was
paid for its goods, and returning everything refunds exactly that amount - however the
returns were split up.
"""

from app.core import bugs


def goods_paid(total_cents: int, shipping_cents: int) -> int:
    """What the shopper paid for the goods themselves: subtotal - discount + tax."""
    return total_cents - shipping_cents


def cumulative_refund(goods_paid_cents: int, subtotal_cents: int, returned_value_cents: int) -> int:
    """Total refunded once goods worth `returned_value_cents` (at list price) are back."""
    if subtotal_cents <= 0 or returned_value_cents <= 0:
        return 0
    if returned_value_cents >= subtotal_cents:
        return goods_paid_cents
    if bugs.active("refund_ignores_discount"):
        return returned_value_cents  # refunds list price: pays back more than was charged
    return goods_paid_cents * returned_value_cents // subtotal_cents


def refund_for_return(
    goods_paid_cents: int,
    subtotal_cents: int,
    value_already_returned_cents: int,
    value_this_return_cents: int,
) -> int:
    before = cumulative_refund(goods_paid_cents, subtotal_cents, value_already_returned_cents)
    after = cumulative_refund(
        goods_paid_cents, subtotal_cents, value_already_returned_cents + value_this_return_cents
    )
    return after - before
