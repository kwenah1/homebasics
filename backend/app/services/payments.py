"""Mock payment gateway (CHK-07). Deterministic test cards; nothing leaves the server.

    4242 4242 4242 4242  -> succeeded
    4000 0000 0000 0002  -> declined (card_declined)
    4000 0000 0000 9995  -> declined (insufficient_funds)
    any other valid card -> declined (test_cards_only) - this store never takes real cards

Only the last four digits are ever stored or returned (PCI-style data minimisation).
"""

import calendar
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime

from app.core import clock

SUCCESS_CARD = "4242424242424242"
DECLINED_CARD = "4000000000000002"
INSUFFICIENT_FUNDS_CARD = "4000000000009995"


@dataclass(frozen=True)
class ChargeResult:
    succeeded: bool
    reason: str | None  # machine-readable decline reason
    last4: str


def normalize_card_number(raw: str) -> str:
    return "".join(ch for ch in raw if ch not in " -")


def luhn_valid(number: str) -> bool:
    if not number.isdigit() or not 12 <= len(number) <= 19:
        return False
    total = 0
    for i, ch in enumerate(reversed(number)):
        digit = int(ch)
        if i % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def card_expired(exp_month: int, exp_year: int, now: datetime | None = None) -> bool:
    """A card is valid through the last moment of its expiry month."""
    now = now or clock.now()
    last_day = calendar.monthrange(exp_year, exp_month)[1]
    end_of_month = datetime(exp_year, exp_month, last_day, 23, 59, 59, tzinfo=UTC)
    return now > end_of_month


def charge(card_number: str) -> ChargeResult:
    number = normalize_card_number(card_number)
    last4 = number[-4:]
    if number == SUCCESS_CARD:
        return ChargeResult(True, None, last4)
    if number == DECLINED_CARD:
        return ChargeResult(False, "card_declined", last4)
    if number == INSUFFICIENT_FUNDS_CARD:
        return ChargeResult(False, "insufficient_funds", last4)
    return ChargeResult(False, "test_cards_only", last4)


def request_fingerprint(**fields: object) -> str:
    """Stable hash of a request body, for idempotency-key reuse detection.

    Never pass a full card number here: the card-number space is small enough that its hash
    can be brute-forced. Use the last four digits and expiry instead."""
    return hashlib.sha256(json.dumps(fields, sort_keys=True, default=str).encode()).hexdigest()
