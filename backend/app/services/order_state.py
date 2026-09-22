r"""Order state machine (ORD-02) - the single source of truth for who may move an order where.

PENDING_PAYMENT --pay--> PAID --> PROCESSING --> SHIPPED --> DELIVERED --> REFUNDED
      |  \                 |           |
      |   `--expire--> EXPIRED         |
      `----------- CANCELLED <---------'   (customer, any time before SHIPPED)
"""

from enum import StrEnum

from app.core.errors import AppError
from app.models import OrderStatus as S


class Actor(StrEnum):
    CUSTOMER = "customer"
    SYSTEM = "system"  # payment gateway, expiry sweep
    ADMIN = "admin"


TRANSITIONS: dict[S, dict[S, frozenset[Actor]]] = {
    S.PENDING_PAYMENT: {
        S.PAID: frozenset({Actor.SYSTEM}),
        S.EXPIRED: frozenset({Actor.SYSTEM}),
        S.CANCELLED: frozenset({Actor.CUSTOMER, Actor.ADMIN}),
    },
    S.PAID: {
        S.PROCESSING: frozenset({Actor.ADMIN}),
        S.CANCELLED: frozenset({Actor.CUSTOMER, Actor.ADMIN}),
    },
    S.PROCESSING: {
        S.SHIPPED: frozenset({Actor.ADMIN}),
        S.CANCELLED: frozenset({Actor.CUSTOMER, Actor.ADMIN}),
    },
    S.SHIPPED: {S.DELIVERED: frozenset({Actor.ADMIN})},
    S.DELIVERED: {S.REFUNDED: frozenset({Actor.ADMIN})},
    S.CANCELLED: {},
    S.EXPIRED: {},
    S.REFUNDED: {},
}

TERMINAL = frozenset(s for s, targets in TRANSITIONS.items() if not targets)
# Leaving these states puts stock back (ORD-01).
RESTOCK_ON = frozenset({S.CANCELLED, S.EXPIRED})


def allowed(current: S, target: S, actor: Actor) -> bool:
    return actor in TRANSITIONS[current].get(target, frozenset())


def check(current: S, target: S, actor: Actor) -> None:
    """Raise 409 invalid_transition for skipped, backwards or unauthorised moves."""
    if not allowed(current, target, actor):
        raise AppError(
            409,
            "invalid_transition",
            f"An order that is {current.value.replace('_', ' ')} can't become "
            f"{target.value.replace('_', ' ')}.",
            extra={"from": current.value, "to": target.value},
        )


def customer_can_cancel(current: S) -> bool:
    return allowed(current, S.CANCELLED, Actor.CUSTOMER)
