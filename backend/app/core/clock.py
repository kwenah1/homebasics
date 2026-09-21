"""Controllable clock (NFR-TEST).

All business rules that depend on time (token expiry, lockout, reset links, order
expiry, coupons) must call ``clock.now()`` - never ``datetime.now()`` directly - so tests
can travel in time without sleeping. Production never changes the offset.
"""

from datetime import UTC, datetime, timedelta

_offset = timedelta(0)
_frozen_at: datetime | None = None


def now() -> datetime:
    if _frozen_at is not None:
        return _frozen_at
    return datetime.now(UTC) + _offset


def advance(delta: timedelta) -> datetime:
    """Move time forward (or back, with a negative delta) relative to the current state."""
    global _offset, _frozen_at
    if _frozen_at is not None:
        _frozen_at += delta
    else:
        _offset += delta
    return now()


def freeze(at: datetime | None = None) -> datetime:
    global _frozen_at
    _frozen_at = (at or now()).astimezone(UTC)
    return _frozen_at


def reset() -> None:
    global _offset, _frozen_at
    _offset = timedelta(0)
    _frozen_at = None


def state() -> dict[str, object]:
    return {
        "now": now().isoformat(),
        "offset_seconds": _offset.total_seconds(),
        "frozen": _frozen_at is not None,
    }
