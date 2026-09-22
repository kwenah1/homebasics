"""Mock gateway rules (CHK-07) and the order state machine (ORD-02)."""

from datetime import UTC, datetime
from itertools import product

import pytest

from app.core import clock
from app.models import OrderStatus as S
from app.services import payments as gw
from app.services.order_state import TERMINAL, TRANSITIONS, Actor, allowed, customer_can_cancel


class TestLuhn:
    @pytest.mark.parametrize(
        "number",
        [
            gw.SUCCESS_CARD,
            gw.DECLINED_CARD,
            gw.INSUFFICIENT_FUNDS_CARD,
            "5555555555554444",
            "378282246310005",
        ],
    )
    def test_valid(self, number):
        assert gw.luhn_valid(number)

    @pytest.mark.parametrize(
        "number", ["4242424242424241", "1234567812345678", "42424242", "", "4242abcd42424242"]
    )
    def test_invalid(self, number):
        assert not gw.luhn_valid(number)

    def test_spaces_and_dashes_are_ignored(self):
        assert gw.normalize_card_number("4242 4242-4242 4242") == gw.SUCCESS_CARD


class TestCharge:
    @pytest.mark.parametrize(
        ("card", "ok", "reason"),
        [
            (gw.SUCCESS_CARD, True, None),
            (gw.DECLINED_CARD, False, "card_declined"),
            (gw.INSUFFICIENT_FUNDS_CARD, False, "insufficient_funds"),
            ("5555555555554444", False, "test_cards_only"),  # a real-looking card: refused
        ],
    )
    def test_outcomes(self, card, ok, reason):
        result = gw.charge(card)
        assert (result.succeeded, result.reason, result.last4) == (ok, reason, card[-4:])

    def test_fingerprint_never_contains_the_card_number(self):
        fp = gw.request_fingerprint(last4="4242", exp="12/2030")
        assert gw.SUCCESS_CARD not in fp and len(fp) == 64


class TestExpiry:
    def test_valid_through_the_last_second_of_the_month(self):
        clock.freeze(datetime(2030, 2, 28, 23, 59, 59, tzinfo=UTC))
        assert gw.card_expired(2, 2030) is False

    def test_expired_the_next_second(self):
        clock.freeze(datetime(2030, 3, 1, 0, 0, 0, tzinfo=UTC))
        assert gw.card_expired(2, 2030) is True

    def test_leap_year_february(self):
        clock.freeze(datetime(2028, 2, 29, 12, 0, tzinfo=UTC))
        assert gw.card_expired(2, 2028) is False


class TestStateMachine:
    EXPECTED = {
        (S.PENDING_PAYMENT, S.PAID, Actor.SYSTEM),
        (S.PENDING_PAYMENT, S.EXPIRED, Actor.SYSTEM),
        (S.PENDING_PAYMENT, S.CANCELLED, Actor.CUSTOMER),
        (S.PENDING_PAYMENT, S.CANCELLED, Actor.ADMIN),
        (S.PAID, S.PROCESSING, Actor.ADMIN),
        (S.PAID, S.CANCELLED, Actor.CUSTOMER),
        (S.PAID, S.CANCELLED, Actor.ADMIN),
        (S.PROCESSING, S.SHIPPED, Actor.ADMIN),
        (S.PROCESSING, S.CANCELLED, Actor.CUSTOMER),
        (S.PROCESSING, S.CANCELLED, Actor.ADMIN),
        (S.SHIPPED, S.DELIVERED, Actor.ADMIN),
        (S.DELIVERED, S.REFUNDED, Actor.ADMIN),
    }

    @pytest.mark.parametrize(("current", "target", "actor"), list(product(S, S, Actor)))
    def test_every_combination(self, current, target, actor):
        """All 8 x 8 x 3 = 192 (from, to, who) combinations: exactly the listed ones pass."""
        assert allowed(current, target, actor) == ((current, target, actor) in self.EXPECTED)

    def test_terminal_states(self):
        assert {S.CANCELLED, S.EXPIRED, S.REFUNDED} == TERMINAL

    def test_every_state_is_defined(self):
        assert set(TRANSITIONS) == set(S)

    @pytest.mark.parametrize(
        ("status", "can"),
        [
            (S.PENDING_PAYMENT, True),
            (S.PAID, True),
            (S.PROCESSING, True),
            (S.SHIPPED, False),
            (S.DELIVERED, False),
            (S.CANCELLED, False),
        ],
    )
    def test_customer_can_cancel_until_shipped(self, status, can):
        assert customer_can_cancel(status) is can

    def test_customers_can_never_mark_paid_or_ship(self):
        for target in (S.PAID, S.PROCESSING, S.SHIPPED, S.DELIVERED, S.REFUNDED):
            assert not any(allowed(s, target, Actor.CUSTOMER) for s in S)
