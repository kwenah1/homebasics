from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.errors import AppError
from app.db import get_db
from app.models import PaymentStatus, User
from app.schemas.checkout import (
    IDEMPOTENCY_KEY_PATTERN,
    OrderOut,
    OrderPage,
    PayIn,
    PlaceOrderIn,
    QuoteIn,
    QuoteOut,
)
from app.services import orders as order_service

checkout = APIRouter(prefix="/checkout", tags=["checkout"])
orders = APIRouter(prefix="/orders", tags=["orders"])

IdempotencyKey = Annotated[
    str,
    Header(
        alias="Idempotency-Key",
        pattern=IDEMPOTENCY_KEY_PATTERN,
        description="Client-generated, 8-48 chars. Retrying with the same key never repeats "
        "the action (CHK-08).",
    ),
]

DECLINE_MESSAGES = {
    "card_declined": "Your card was declined.",
    "insufficient_funds": "Your card has insufficient funds.",
    "test_cards_only": "This practice store only accepts its test cards.",
}


def _mark_replay(response: Response, replayed: bool) -> None:
    if replayed:
        response.headers["Idempotent-Replayed"] = "true"


@checkout.post("/quote", response_model=QuoteOut)
def quote(data: QuoteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """CHK-01..03: price the account cart for an address and shipping method. Read-only."""
    return order_service.build_quote(db, user, data)


@checkout.post(
    "/place-order",
    response_model=OrderOut,
    status_code=status.HTTP_201_CREATED,
    responses={200: {"description": "Replay of an earlier request with this key"}},
)
def place_order(
    data: PlaceOrderIn,
    key: IdempotencyKey,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Creates a PENDING_PAYMENT order (30-minute payment window) and takes the stock.
    409 cart_empty / cart_has_issues (per-line) / total_changed."""
    order, replayed = order_service.place_order(db, user, data, key)
    if replayed:
        response.status_code = status.HTTP_200_OK
    _mark_replay(response, replayed)
    return order_service.order_out(db, order)


@orders.get("", response_model=OrderPage)
def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return order_service.list_orders(db, user, page, page_size)


@orders.get("/{order_number}", response_model=OrderOut)
def get_order(
    order_number: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return order_service.get_order(db, user, order_number)


@orders.post(
    "/{order_number}/pay",
    response_model=OrderOut,
    responses={402: {"description": "Card declined (order stays payable)"}},
)
def pay(
    order_number: str,
    data: PayIn,
    key: IdempotencyKey,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """CHK-07 mock gateway. A decline is 402 and can be retried with a new key; replaying a
    key returns the original outcome and never charges twice (CHK-08)."""
    order, payment, replayed = order_service.pay(db, user, order_number, data, key)
    if payment.status != PaymentStatus.SUCCEEDED:
        reason = payment.failure_reason or "card_declined"
        headers = {"Idempotent-Replayed": "true"} if replayed else None
        raise AppError(
            402,
            reason,
            DECLINE_MESSAGES.get(reason, "Your card was declined."),
            headers=headers,
            extra={"order_number": order.order_number, "can_retry": True},
        )
    _mark_replay(response, replayed)
    return order_service.order_out(db, order)


@orders.post("/{order_number}/cancel", response_model=OrderOut)
def cancel(
    order_number: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Customer cancellation, allowed until the order ships. Stock goes back; a paid order
    is refunded."""
    order = order_service.cancel(db, user, order_number)
    return order_service.order_out(db, order)
