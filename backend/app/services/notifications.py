"""Customer and staff emails (EML-01..03, ALR-01).

Every message is queued in the *same transaction* as the change it describes (a transactional
outbox): if the change rolls back, the email was never sent; if it commits, the email is
there. A sender process would deliver from the outbox table in a real deployment.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import bugs
from app.models import (
    Order,
    OrderStatus,
    Payment,
    PaymentStatus,
    Product,
    ReturnRequest,
    ReturnStatus,
    User,
    UserRole,
)
from app.services.email import queue_email


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _customer(db: Session, order: Order) -> User:
    return db.get(User, order.user_id)


# --- Orders (EML-01) ------------------------------------------------------------------------------

_STATUS_MAIL = {
    OrderStatus.PAID: ("Payment received for {n}", "We've received {total} for order {n}."),
    OrderStatus.SHIPPED: ("Your order {n} has shipped", "Order {n} is on its way."),
    OrderStatus.DELIVERED: (
        "Your order {n} was delivered",
        "Order {n} was delivered. You can return items within 30 days.",
    ),
    OrderStatus.CANCELLED: ("Order {n} cancelled", "Order {n} was cancelled.{refund}"),
    OrderStatus.EXPIRED: (
        "Order {n} expired",
        "We didn't receive payment for order {n} in time, so it was cancelled. "
        "Nothing was charged.",
    ),
    OrderStatus.REFUNDED: ("Refund for order {n}", "Order {n} has been refunded."),
}


def order_placed(db: Session, order: Order) -> None:
    user = _customer(db, order)
    queue_email(
        db,
        user.email,
        f"Order {order.order_number} received - please pay within 30 minutes",
        f"Hi {user.first_name},\n\n"
        f"Thanks for your order {order.order_number} ({_money(order.total_cents)}). "
        "Please complete payment within 30 minutes, or the order will be cancelled "
        "automatically.\n",
    )


def order_status(db: Session, order: Order, status: OrderStatus) -> None:
    """Called by orders.transition for every status change; PROCESSING sends nothing."""
    template = _STATUS_MAIL.get(status)
    if template is None:
        return
    # A paid order that's cancelled is always refunded (by whoever cancels it).
    refunded = (
        status == OrderStatus.CANCELLED
        and db.scalar(
            select(Payment.id).where(
                Payment.order_id == order.id, Payment.status == PaymentStatus.SUCCEEDED
            )
        )
        is not None
    )
    user = _customer(db, order)
    subject, body = template
    fields = {
        "n": order.order_number,
        "total": _money(order.total_cents),
        "refund": " Your payment has been refunded." if refunded else "",
    }
    queue_email(
        db,
        user.email,
        subject.format(**fields),
        f"Hi {user.first_name},\n\n{body.format(**fields)}\n",
    )


# --- Returns (EML-02) -----------------------------------------------------------------------------

_RETURN_MAIL = {
    ReturnStatus.REQUESTED: "We've received your return request {r} for order {n}.",
    ReturnStatus.APPROVED: "Your return {r} was approved. Please send the items back.",
    ReturnStatus.REJECTED: "Your return {r} couldn't be accepted: {note}",
    ReturnStatus.CANCELLED: "Your return {r} was cancelled.",
    ReturnStatus.RECEIVED: "We've received the items for return {r}. {refund} is on its way "
    "back to your card.",
}


def return_update(db: Session, user: User, ret: ReturnRequest, order: Order) -> None:
    body = _RETURN_MAIL[ret.status].format(
        r=ret.return_number,
        n=order.order_number,
        note=ret.staff_note or "",
        refund=_money(ret.refund_cents or 0),
    )
    queue_email(
        db,
        user.email,
        f"Return {ret.return_number}: {ret.status.value}",
        f"Hi {user.first_name},\n\n{body}\n",
    )


# --- Low stock (ALR-01) ---------------------------------------------------------------------------


def stock_changed(db: Session, product: Product, before: int, after: int) -> None:
    """Alert staff when stock *crosses* into low or out of stock - once per crossing, not on
    every sale while it stays low."""
    from app.services.catalog import LOW_STOCK_THRESHOLD

    if after >= before:
        return
    if after == 0:
        subject = f"Out of stock: {product.sku} {product.name}"
    elif (before > LOW_STOCK_THRESHOLD or bugs.active("low_stock_alert_every_sale")) and (
        after <= LOW_STOCK_THRESHOLD
    ):
        subject = f"Low stock: {product.sku} {product.name} ({after} left)"
    else:
        return
    admins = db.scalars(select(User.email).where(User.role == UserRole.ADMIN).order_by(User.id))
    for email in admins:
        queue_email(
            db,
            email,
            subject,
            f"{product.name} ({product.sku}) went from {before} to {after} in stock.\n",
        )
