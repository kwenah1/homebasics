"""Returns (RET-01..06): the 30-day window, what can still be returned, the return's own small
state machine, and refunds + restocking when the goods arrive back.

Every change locks the order row first (then products in id order, like checkout), so two
return requests for the same order can't together return more units than were bought.
"""

import secrets
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core import bugs, clock
from app.core.errors import AppError
from app.models import (
    InventoryMovement,
    InventoryReason,
    Order,
    OrderItem,
    OrderStatus,
    Payment,
    PaymentStatus,
    Product,
    ReturnItem,
    ReturnRequest,
    ReturnStatus,
    User,
)
from app.schemas.returns import (
    AdminReturnOut,
    ReceiveIn,
    Returnable,
    ReturnCreate,
    ReturnLineOut,
    ReturnOut,
    ReturnWindow,
)
from app.services import notifications
from app.services.order_state import Actor
from app.services.refunds import goods_paid, refund_for_return

RETURN_WINDOW = timedelta(days=30)  # RET-01
_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

S = ReturnStatus
# RET-03: who may move a return where. Anything else is 409.
TRANSITIONS: dict[ReturnStatus, dict[ReturnStatus, Actor]] = {
    S.REQUESTED: {S.APPROVED: Actor.ADMIN, S.REJECTED: Actor.ADMIN, S.CANCELLED: Actor.CUSTOMER},
    S.APPROVED: {S.RECEIVED: Actor.ADMIN, S.REJECTED: Actor.ADMIN, S.CANCELLED: Actor.CUSTOMER},
}
OPEN = (S.REQUESTED, S.APPROVED)
# Units in these returns are spoken for: they can't be returned again.
HOLDING = (S.REQUESTED, S.APPROVED, S.RECEIVED)


def new_return_number() -> str:
    return "RT-" + "".join(secrets.choice(_ALPHABET) for _ in range(8))


def _check(current: ReturnStatus, target: ReturnStatus, actor: Actor) -> None:
    if TRANSITIONS.get(current, {}).get(target) != actor:
        raise AppError(
            409,
            "invalid_return_transition",
            f"A return that is {current.value} can't become {target.value}.",
            extra={"from": current.value, "to": target.value},
        )


# --- Window and quantities ---------------------------------------------------------------------


def return_by(order: Order):
    return order.delivered_at + RETURN_WINDOW if order.delivered_at else None


def window_open(order: Order) -> bool:
    deadline = return_by(order)
    if order.status != OrderStatus.DELIVERED or deadline is None:
        return False
    now = clock.now()
    return now <= deadline if bugs.active("return_window_off_by_one") else now < deadline


def _held(db: Session, order_id: int) -> dict[int, int]:
    """order_item_id -> units already in open or received returns."""
    return dict(
        db.execute(
            select(ReturnItem.order_item_id, func.sum(ReturnItem.quantity))
            .join(ReturnRequest, ReturnRequest.id == ReturnItem.return_id)
            .where(ReturnRequest.order_id == order_id, ReturnRequest.status.in_(HOLDING))
            .group_by(ReturnItem.order_item_id)
        ).all()
    )


def returnable(db: Session, order: Order) -> list[Returnable]:
    held = _held(db, order.id)
    return [
        Returnable(
            product_id=i.product_id,
            sku=i.sku,
            product_name=i.product_name,
            quantity=i.quantity - held.get(i.id, 0),
        )
        for i in sorted(order.items, key=lambda i: i.id)
        if i.quantity - held.get(i.id, 0) > 0
    ]


def window(db: Session, order: Order) -> ReturnWindow:
    left = returnable(db, order) if window_open(order) else []
    return ReturnWindow(can_return=bool(left), return_by=return_by(order), returnable=left)


# --- Output ------------------------------------------------------------------------------------


def _value(ret: ReturnRequest) -> int:
    return sum(i.order_item.unit_price_cents * i.quantity for i in ret.items)


def return_out(ret: ReturnRequest) -> ReturnOut:
    return ReturnOut(
        return_number=ret.return_number,
        order_number=ret.order.order_number,
        status=ret.status,
        reason=ret.reason,
        note=ret.note,
        staff_note=ret.staff_note,
        items=[
            ReturnLineOut(
                product_id=i.order_item.product_id,
                sku=i.order_item.sku,
                product_name=i.order_item.product_name,
                unit_price_cents=i.order_item.unit_price_cents,
                quantity=i.quantity,
            )
            for i in sorted(ret.items, key=lambda i: i.id)
        ],
        value_cents=_value(ret),
        refund_cents=ret.refund_cents,
        restocked=ret.restocked,
        created_at=ret.created_at,
        updated_at=ret.updated_at,
        can_cancel=ret.status in OPEN,
    )


def admin_return_out(ret: ReturnRequest) -> AdminReturnOut:
    return AdminReturnOut(
        **return_out(ret).model_dump(),
        customer_email=ret.user.email,
        customer_name=f"{ret.user.first_name} {ret.user.last_name}",
    )


_LOAD = (
    selectinload(ReturnRequest.items).selectinload(ReturnItem.order_item),
    selectinload(ReturnRequest.order),
    selectinload(ReturnRequest.user),
)


# --- Customer ----------------------------------------------------------------------------------


def _lock_order(db: Session, order_id: int) -> Order:
    return db.scalar(
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.items))
        .with_for_update(of=Order)
        .execution_options(populate_existing=True)
    )


def create_return(db: Session, user: User, order_number: str, data: ReturnCreate) -> ReturnOut:
    order = db.scalar(
        select(Order).where(Order.order_number == order_number, Order.user_id == user.id)
    )
    if order is None:
        raise AppError(404, "order_not_found", "Order not found.")
    order = _lock_order(db, order.id)
    if not window_open(order):
        raise AppError(
            409,
            "return_window_closed",
            "Returns are accepted for 30 days after delivery.",
            extra={"return_by": return_by(order).isoformat() if return_by(order) else None},
        )
    by_product = {i.product_id: i for i in order.items}
    held = _held(db, order.id)
    problems = {}
    for line in data.items:
        item = by_product.get(line.product_id)
        if item is None:
            problems[str(line.product_id)] = "Not on this order."
        elif line.quantity > item.quantity - held.get(item.id, 0):
            problems[str(line.product_id)] = (
                f"Only {item.quantity - held.get(item.id, 0)} can still be returned."
            )
    if problems:
        raise AppError(
            422,
            "return_quantity_invalid",
            "Some items can't be returned in those quantities.",
            extra={"lines": problems},
        )

    ret = ReturnRequest(
        return_number=new_return_number(),
        order_id=order.id,
        user_id=user.id,
        status=S.REQUESTED,
        reason=data.reason,
        note=data.note or None,
        items=[
            ReturnItem(order_item_id=by_product[line.product_id].id, quantity=line.quantity)
            for line in data.items
        ],
    )
    db.add(ret)
    db.flush()
    notifications.return_update(db, user, ret, order)
    db.commit()
    return get_for_customer(db, user, ret.return_number)


def _mine(db: Session, user: User, number: str, *, lock: bool = False) -> ReturnRequest:
    stmt = select(ReturnRequest).where(
        ReturnRequest.return_number == number, ReturnRequest.user_id == user.id
    )
    ret = db.scalar(stmt)
    if ret is None:
        raise AppError(404, "return_not_found", "Return not found.")
    if lock:
        _lock_order(db, ret.order_id)
    return db.scalar(
        select(ReturnRequest)
        .where(ReturnRequest.id == ret.id)
        .options(*_LOAD)
        .execution_options(populate_existing=True)
    )


def get_for_customer(db: Session, user: User, number: str) -> ReturnOut:
    return return_out(_mine(db, user, number))


def list_for_customer(db: Session, user: User, order_number: str | None = None) -> list[ReturnOut]:
    stmt = select(ReturnRequest).where(ReturnRequest.user_id == user.id).options(*_LOAD)
    if order_number is not None:
        order = db.scalar(
            select(Order).where(Order.order_number == order_number, Order.user_id == user.id)
        )
        if order is None:
            raise AppError(404, "order_not_found", "Order not found.")
        stmt = stmt.where(ReturnRequest.order_id == order.id)
    rows = db.scalars(stmt.order_by(ReturnRequest.created_at.desc(), ReturnRequest.id.desc()))
    return [return_out(r) for r in rows]


def cancel(db: Session, user: User, number: str) -> ReturnOut:
    ret = _mine(db, user, number, lock=True)
    _check(ret.status, S.CANCELLED, Actor.CUSTOMER)
    ret.status = S.CANCELLED
    notifications.return_update(db, user, ret, ret.order)
    db.commit()
    return get_for_customer(db, user, number)


# --- Admin (ADM-07) ------------------------------------------------------------------------------


def _for_admin(db: Session, number: str) -> ReturnRequest:
    ret = db.scalar(select(ReturnRequest).where(ReturnRequest.return_number == number))
    if ret is None:
        raise AppError(404, "return_not_found", "Return not found.")
    _lock_order(db, ret.order_id)
    return db.scalar(
        select(ReturnRequest)
        .where(ReturnRequest.id == ret.id)
        .options(*_LOAD)
        .execution_options(populate_existing=True)
    )


def admin_list(db: Session, status: ReturnStatus | None) -> list[AdminReturnOut]:
    stmt = select(ReturnRequest).options(*_LOAD)
    if status is not None:
        stmt = stmt.where(ReturnRequest.status == status)
    rows = db.scalars(stmt.order_by(ReturnRequest.created_at.desc(), ReturnRequest.id.desc()))
    return [admin_return_out(r) for r in rows]


def admin_get(db: Session, number: str) -> AdminReturnOut:
    ret = db.scalar(
        select(ReturnRequest).where(ReturnRequest.return_number == number).options(*_LOAD)
    )
    if ret is None:
        raise AppError(404, "return_not_found", "Return not found.")
    return admin_return_out(ret)


def _decide(db: Session, number: str, target: ReturnStatus, note: str | None) -> AdminReturnOut:
    ret = _for_admin(db, number)
    _check(ret.status, target, Actor.ADMIN)
    ret.status = target
    if note:
        ret.staff_note = note
    notifications.return_update(db, ret.user, ret, ret.order)
    db.commit()
    return admin_get(db, number)


def approve(db: Session, number: str, note: str | None) -> AdminReturnOut:
    return _decide(db, number, S.APPROVED, note)


def reject(db: Session, number: str, note: str) -> AdminReturnOut:
    return _decide(db, number, S.REJECTED, note)


def receive(db: Session, admin: User, number: str, data: ReceiveIn) -> AdminReturnOut:
    """RET-04: goods are back - refund the paid share, restock if sellable, and close the
    order as refunded once everything has come back."""
    from app.services import orders as order_service  # circular: orders -> notifications

    ret = _for_admin(db, number)
    _check(ret.status, S.RECEIVED, Actor.ADMIN)
    order = ret.order

    already = db.scalars(
        select(ReturnRequest)
        .where(ReturnRequest.order_id == order.id, ReturnRequest.status == S.RECEIVED)
        .options(selectinload(ReturnRequest.items).selectinload(ReturnItem.order_item))
    ).all()
    value_before = sum(_value(r) for r in already)
    refund = refund_for_return(
        goods_paid(order.total_cents, order.shipping_cents),
        order.subtotal_cents,
        value_before,
        _value(ret),
    )
    charge = db.scalar(
        select(Payment).where(
            Payment.order_id == order.id, Payment.status == PaymentStatus.SUCCEEDED
        )
    )
    if refund > 0:
        db.add(
            Payment(
                order_id=order.id,
                idempotency_key=f"return:{ret.id}",
                amount_cents=refund,
                status=PaymentStatus.REFUNDED,
                card_last4=charge.card_last4 if charge else None,
            )
        )

    if data.restock:
        items = sorted(ret.items, key=lambda i: i.order_item.product_id)
        products = {
            p.id: p
            for p in db.scalars(
                select(Product)
                .where(Product.id.in_([i.order_item.product_id for i in items]))
                .order_by(Product.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        }
        for item in items:
            pid = item.order_item.product_id
            products[pid].stock_qty = Product.stock_qty + item.quantity
            db.add(
                InventoryMovement(
                    product_id=pid,
                    delta=item.quantity,
                    reason=InventoryReason.RETURN_RESTOCK,
                    order_id=order.id,
                    actor_user_id=admin.id,
                    note=ret.return_number,
                )
            )

    ret.status = S.RECEIVED
    ret.refund_cents = refund
    ret.restocked = data.restock
    if data.note:
        ret.staff_note = data.note
    db.flush()

    ordered = db.scalar(select(func.sum(OrderItem.quantity)).where(OrderItem.order_id == order.id))
    received = db.scalar(
        select(func.sum(ReturnItem.quantity))
        .join(ReturnRequest, ReturnRequest.id == ReturnItem.return_id)
        .where(ReturnRequest.order_id == order.id, ReturnRequest.status == S.RECEIVED)
    )
    if received == ordered:
        order_service.transition(
            db,
            order,
            OrderStatus.REFUNDED,
            Actor.ADMIN,
            actor_user_id=admin.id,
            note="All items returned",
        )
    notifications.return_update(db, ret.user, ret, order)
    db.commit()
    return admin_get(db, number)


def has_open_return(db: Session, order_id: int) -> bool:
    return (
        db.scalar(
            select(func.count())
            .select_from(ReturnRequest)
            .where(ReturnRequest.order_id == order_id, ReturnRequest.status.in_(OPEN))
        )
        > 0
    )
