"""Checkout, payment and the order lifecycle: CHK-01..08, ORD-01..03."""

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
    OrderStatusHistory,
    Payment,
    PaymentStatus,
    Product,
    ShippingMethod,
    TaxRate,
    User,
)
from app.schemas.checkout import (
    AddressSnapshot,
    OrderItemOut,
    OrderOut,
    OrderPage,
    OrderSummary,
    PayIn,
    PaymentOut,
    PlaceOrderIn,
    QuoteIn,
    QuoteOut,
    ShippingOption,
    StatusEventOut,
)
from app.services import addresses as address_service
from app.services import cart as cart_service
from app.services import coupons as coupon_service
from app.services import notifications, order_state
from app.services import payments as gateway
from app.services import returns as return_service
from app.services.order_state import Actor
from app.services.pricing import price_order

PAYMENT_WINDOW = timedelta(minutes=30)  # ORD-01
_ORDER_NO_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O/1/I - easy to read aloud


def new_order_number() -> str:
    return "HB-" + "".join(secrets.choice(_ORDER_NO_ALPHABET) for _ in range(8))


def scoped_key(user: User, key: str) -> str:
    """Idempotency keys belong to one shopper: two shoppers can reuse the same string."""
    return f"{user.id}:{key}"


# --- Quote ------------------------------------------------------------------------------


def _tax_rate(db: Session, state: str) -> TaxRate:
    rate = db.get(TaxRate, state)
    if rate is None:  # addresses are validated against this table, so this is defensive
        raise AppError(422, "unsupported_state", f"We can't ship to {state}.")
    return rate


def build_quote(db: Session, user: User, data: QuoteIn) -> QuoteOut:
    address = address_service.get_owned(db, user, data.address_id)
    rate = _tax_rate(db, address.state)
    cart = cart_service.get_cart(db, user)
    healthy = [line.line_total_cents for line in cart.items if line.issue is None]
    coupon, discount = None, 0
    if data.coupon_code:
        coupon, discount = coupon_service.evaluate(db, user, data.coupon_code, sum(healthy))
    totals = price_order(healthy, rate.rate, data.shipping_method, discount)

    options = [
        ShippingOption(method=m, cents=price_order(healthy, rate.rate, m, discount).shipping_cents)
        for m in ShippingMethod
    ]
    blocking = (
        "Your cart is empty."
        if not cart.items
        else "Some items in your cart need attention."
        if cart.has_issues
        else None
    )
    return QuoteOut(
        lines=cart.items,
        item_count=cart.item_count,
        subtotal_cents=totals.subtotal_cents,
        discount_cents=totals.discount_cents,
        coupon=coupon_service.applied(coupon, totals.discount_cents) if coupon else None,
        tax_rate=float(rate.rate),
        tax_state=rate.state_code,
        tax_cents=totals.tax_cents,
        shipping_method=data.shipping_method,
        shipping_cents=totals.shipping_cents,
        total_cents=totals.total_cents,
        shipping_options=options,
        can_place_order=blocking is None,
        blocking_reason=blocking,
    )


# --- Lifecycle helpers ----------------------------------------------------------------------


def transition(
    db: Session,
    order: Order,
    target: OrderStatus,
    actor: Actor,
    *,
    actor_user_id: int | None = None,
    note: str | None = None,
) -> None:
    """The only way an order's status changes (ORD-02, ORD-03)."""
    order_state.check(order.status, target, actor)
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=order.status,
            to_status=target,
            actor_user_id=actor_user_id,
            note=note,
        )
    )
    order.status = target
    if target == OrderStatus.DELIVERED:
        order.delivered_at = clock.now()  # RET-01: the return window starts here
    notifications.order_status(db, order, target)
    if target in order_state.RESTOCK_ON and not (
        target == OrderStatus.CANCELLED and bugs.active("stock_not_restored_on_cancel")
    ):
        _restock(db, order, InventoryReason(f"order_{target.value}"))


def _restock(db: Session, order: Order, reason: InventoryReason) -> None:
    """ORD-01: stock taken at placement goes back when an order is cancelled or expires."""
    items = sorted(order.items, key=lambda i: i.product_id)  # same lock order as placement
    products = {
        p.id: p
        for p in db.scalars(
            select(Product)
            .where(Product.id.in_([i.product_id for i in items]))
            .order_by(Product.id)
            .with_for_update()
            # Regression (found by the E2E last-unit race): without this, rows already in the
            # session (loaded with the cart) kept their stale stock after we waited for the
            # lock - so two shoppers both bought the last unit. The lock must re-read the row.
            .execution_options(populate_existing=True)
        )
    }
    for item in items:
        products[item.product_id].stock_qty = Product.stock_qty + item.quantity
        db.add(
            InventoryMovement(
                product_id=item.product_id, delta=item.quantity, reason=reason, order_id=order.id
            )
        )


def _is_overdue(order: Order) -> bool:
    return (
        order.status == OrderStatus.PENDING_PAYMENT
        and order.payment_expires_at is not None
        and order.payment_expires_at <= clock.now()
    )


def expire_overdue(db: Session) -> int:
    """ORD-01: unpaid orders past their 30-minute window expire and release their stock.

    Runs before catalog, cart, checkout and order requests (and via /test/expire-orders); a
    production deployment would also run it on a schedule.

    Regression (found by E2E, 1 run in 4): this used SKIP LOCKED, so when one page fired
    several requests at once, a sweep that skipped the row another sweep was expiring went
    on to read stock *before* that sweep committed - and showed 'Out of stock' for an item
    that was back on sale. Waiting instead is consistent: after the lock is released,
    Postgres re-checks the WHERE clause, the row is no longer pending and is skipped, and the
    stock read that follows sees the committed restock.
    """
    overdue = db.scalars(
        select(Order)
        .where(
            Order.status == OrderStatus.PENDING_PAYMENT,
            Order.payment_expires_at <= clock.now(),
        )
        .options(selectinload(Order.items))
        .with_for_update(of=Order)
        .execution_options(populate_existing=True)  # locked rows must be re-read
    ).all()
    for order in overdue:
        transition(db, order, OrderStatus.EXPIRED, Actor.SYSTEM, note="Payment window closed")
    if overdue:
        db.commit()
    return len(overdue)


# --- Place order ----------------------------------------------------------------------------


def place_order(db: Session, user: User, data: PlaceOrderIn, key: str) -> tuple[Order, bool]:
    """Returns (order, replayed). CHK-04 re-checks stock under lock; CHK-06 snapshots."""
    expire_overdue(db)  # release stock held by abandoned orders first
    fingerprint = gateway.request_fingerprint(
        address_id=data.address_id,
        shipping_method=data.shipping_method.value,
        expected_total_cents=data.expected_total_cents,
        # Only when present, so fingerprints of coupon-less requests are unchanged.
        **({"coupon_code": data.coupon_code} if data.coupon_code else {}),
    )
    cart = cart_service.lock_cart(db, user)  # serialises this shopper's checkouts

    # CHK-08: the same key (and same request) returns the order already created.
    existing = db.scalar(
        select(Order).where(Order.user_id == user.id, Order.idempotency_key == key)
    )
    if existing is not None and not bugs.active("idempotency_ignored"):
        if existing.request_hash != fingerprint:
            raise AppError(
                422,
                "idempotency_key_reused",
                "This Idempotency-Key was already used for a different request.",
            )
        return existing, True

    address = address_service.get_owned(db, user, data.address_id)
    rate = _tax_rate(db, address.state)
    lines = cart_service.cart_lines(db, cart.id)
    if not lines:
        raise AppError(409, "cart_empty", "Your cart is empty.")

    # Lock the products in id order so two checkouts can never deadlock on each other.
    products = {
        p.id: p
        for p in db.scalars(
            select(Product)
            .where(Product.id.in_([line.product_id for line in lines]))
            .order_by(Product.id)
            .with_for_update()
            # Regression (found by the E2E last-unit race): without this, rows already in the
            # session (loaded with the cart) kept their stale stock after we waited for the
            # lock - so two shoppers both bought the last unit. The lock must re-read the row.
            .execution_options(populate_existing=True)
        )
    }
    problems = []
    for line in lines:
        product = products[line.product_id]
        issue, available = cart_service.line_issue(product, line.quantity)
        if issue:
            problems.append(
                {
                    "product_id": product.id,
                    "sku": product.sku,
                    "issue": issue,
                    "requested": line.quantity,
                    "available": 0 if issue != "insufficient_stock" else available,
                }
            )
    if problems:
        raise AppError(
            409,
            "cart_has_issues",
            "Some items can't be ordered as they are. Review your cart.",
            extra={"lines": problems},
        )

    line_totals = [products[line.product_id].price_cents * line.quantity for line in lines]
    coupon, discount = None, 0
    if data.coupon_code:
        # Locks the coupon row (after the products - every checkout takes locks in the same
        # order: cart, products, coupon), so the last use can't be taken twice (CPN-04).
        coupon, discount = coupon_service.evaluate(
            db, user, data.coupon_code, sum(line_totals), lock=True
        )
    totals = price_order(line_totals, rate.rate, data.shipping_method, discount)
    if totals.total_cents != data.expected_total_cents:
        raise AppError(
            409,
            "total_changed",
            "Your total changed since you last saw it. Please review it before ordering.",
            extra={
                "expected_total_cents": data.expected_total_cents,
                "current_total_cents": totals.total_cents,
            },
        )

    now = clock.now()
    order = Order(
        order_number=new_order_number(),
        user_id=user.id,
        idempotency_key=key,
        request_hash=fingerprint,
        status=OrderStatus.PENDING_PAYMENT,
        shipping_method=data.shipping_method,
        ship_name=address.recipient_name,
        ship_line1=address.line1,
        ship_line2=address.line2,
        ship_city=address.city,
        ship_state=address.state,
        ship_postal_code=address.postal_code,
        subtotal_cents=totals.subtotal_cents,
        discount_cents=totals.discount_cents,
        coupon_code=coupon.code if coupon else None,
        tax_rate=totals.tax_rate,
        tax_cents=totals.tax_cents,
        shipping_cents=totals.shipping_cents,
        total_cents=totals.total_cents,
        placed_at=now,
        payment_expires_at=now + PAYMENT_WINDOW,
    )
    db.add(order)
    db.flush()
    if coupon is not None:
        coupon_service.redeem(db, coupon, user, order)

    for line in lines:
        product = products[line.product_id]
        db.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                sku=product.sku,
                product_name=product.name,
                unit_price_cents=product.price_cents,
                quantity=line.quantity,
                line_total_cents=product.price_cents * line.quantity,
            )
        )
        # ORD-01: stock is taken at placement. Relative SQL update (stock_qty = stock_qty - n):
        # even if a stale read slipped through, the CHECK (stock_qty >= 0) would refuse an
        # oversell instead of silently writing a value computed from old data.
        before = product.stock_qty  # fresh: the row was re-read under its lock
        product.stock_qty = Product.stock_qty - line.quantity
        notifications.stock_changed(db, product, before, before - line.quantity)
        db.add(
            InventoryMovement(
                product_id=product.id,
                delta=-line.quantity,
                reason=InventoryReason.ORDER_PLACED,
                order_id=order.id,
                actor_user_id=user.id,
            )
        )
        db.delete(line)

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            from_status=None,
            to_status=OrderStatus.PENDING_PAYMENT,
            actor_user_id=user.id,
            note="Order placed",
        )
    )
    notifications.order_placed(db, order)
    db.commit()
    return order, False


# --- Pay --------------------------------------------------------------------------------------


def _owned_order_for_update(db: Session, user: User, number: str) -> Order:
    order = db.scalar(
        select(Order)
        .where(Order.order_number == number, Order.user_id == user.id)
        .options(selectinload(Order.items))
        .with_for_update(of=Order)
        .execution_options(populate_existing=True)  # locked rows must be re-read
    )
    if order is None:  # someone else's order looks exactly like a missing one
        raise AppError(404, "order_not_found", "Order not found.")
    return order


def pay(db: Session, user: User, number: str, data: PayIn, key: str) -> tuple[Order, Payment, bool]:
    """Returns (order, payment, replayed). A decline is a normal result, not an exception."""
    order = _owned_order_for_update(db, user, number)
    card = gateway.normalize_card_number(data.card_number)
    fingerprint = gateway.request_fingerprint(
        order=order.order_number, last4=card[-4:], exp=f"{data.exp_month}/{data.exp_year}"
    )
    stored_key = scoped_key(user, key)

    existing = db.scalar(select(Payment).where(Payment.idempotency_key == stored_key))
    if existing is not None:
        if existing.order_id != order.id or existing.request_hash != fingerprint:
            raise AppError(
                422,
                "idempotency_key_reused",
                "This Idempotency-Key was already used for a different request.",
            )
        return order, existing, True

    if _is_overdue(order):
        transition(db, order, OrderStatus.EXPIRED, Actor.SYSTEM, note="Payment window closed")
        db.commit()
        raise AppError(409, "order_expired", "The 30-minute payment window has closed.")
    if order.status != OrderStatus.PENDING_PAYMENT:
        code = "order_already_paid" if order.status == OrderStatus.PAID else "order_not_payable"
        raise AppError(409, code, "This order can't be paid.", extra={"status": order.status.value})

    if not gateway.luhn_valid(card):
        raise AppError(
            422,
            "invalid_card_number",
            "That card number isn't valid.",
            fields={"card_number": "Check the card number."},
        )
    if gateway.card_expired(data.exp_month, data.exp_year):
        raise AppError(
            422,
            "card_expired",
            "That card has expired.",
            fields={"exp_month": "This card has expired."},
        )

    result = gateway.charge(card)
    payment = Payment(
        order_id=order.id,
        idempotency_key=stored_key,
        request_hash=fingerprint,
        amount_cents=order.total_cents,
        status=PaymentStatus.SUCCEEDED if result.succeeded else PaymentStatus.DECLINED,
        card_last4=result.last4,
        failure_reason=result.reason,
    )
    db.add(payment)
    if result.succeeded:
        transition(
            db, order, OrderStatus.PAID, Actor.SYSTEM, note=f"Paid with card ••{result.last4}"
        )
    db.commit()
    return order, payment, False


# --- Cancel ------------------------------------------------------------------------------------


def cancel(db: Session, user: User, number: str) -> Order:
    order = _owned_order_for_update(db, user, number)
    if _is_overdue(order):
        transition(db, order, OrderStatus.EXPIRED, Actor.SYSTEM, note="Payment window closed")
        db.commit()
        raise AppError(409, "order_expired", "This order already expired.")
    paid = db.scalar(
        select(Payment).where(
            Payment.order_id == order.id, Payment.status == PaymentStatus.SUCCEEDED
        )
    )
    transition(
        db,
        order,
        OrderStatus.CANCELLED,
        Actor.CUSTOMER,
        actor_user_id=user.id,
        note="Cancelled by customer" + ("; payment refunded" if paid else ""),
    )
    if paid:
        db.add(
            Payment(
                order_id=order.id,
                idempotency_key=f"refund:{order.id}",
                amount_cents=paid.amount_cents,
                status=PaymentStatus.REFUNDED,
                card_last4=paid.card_last4,
            )
        )
    db.commit()
    return order


# --- Reads -------------------------------------------------------------------------------------


def order_out(db: Session, order: Order) -> OrderOut:
    order = db.scalar(
        select(Order)
        .where(Order.id == order.id)
        .options(
            selectinload(Order.items),
            selectinload(Order.status_history),
            selectinload(Order.payments),
        )
        .execution_options(populate_existing=True)
    )
    now = clock.now()
    return OrderOut(
        order_number=order.order_number,
        status=order.status,
        placed_at=order.placed_at,
        payment_expires_at=order.payment_expires_at,
        delivered_at=order.delivered_at,
        shipping_method=order.shipping_method,
        ship_to=AddressSnapshot(
            name=order.ship_name,
            line1=order.ship_line1,
            line2=order.ship_line2,
            city=order.ship_city,
            state=order.ship_state,
            postal_code=order.ship_postal_code,
        ),
        items=[
            OrderItemOut(
                product_id=i.product_id,
                sku=i.sku,
                product_name=i.product_name,
                unit_price_cents=i.unit_price_cents,
                quantity=i.quantity,
                line_total_cents=i.line_total_cents,
            )
            for i in sorted(order.items, key=lambda i: i.id)
        ],
        subtotal_cents=order.subtotal_cents,
        discount_cents=order.discount_cents,
        coupon_code=order.coupon_code,
        tax_rate=float(order.tax_rate),
        tax_cents=order.tax_cents,
        shipping_cents=order.shipping_cents,
        total_cents=order.total_cents,
        history=[
            StatusEventOut(
                from_status=h.from_status, to_status=h.to_status, at=h.created_at, note=h.note
            )
            for h in order.status_history
        ],
        payments=[
            PaymentOut(
                status=p.status,
                amount_cents=p.amount_cents,
                card_last4=p.card_last4,
                failure_reason=p.failure_reason,
                at=p.created_at,
            )
            for p in sorted(order.payments, key=lambda p: p.id)
        ],
        can_pay=order.status == OrderStatus.PENDING_PAYMENT
        and order.payment_expires_at is not None
        and order.payment_expires_at > now,
        can_cancel=order_state.customer_can_cancel(order.status) and not _is_overdue(order),
        return_window=return_service.window(db, order),
    )


def get_order(db: Session, user: User, number: str) -> OrderOut:
    expire_overdue(db)
    order = db.scalar(select(Order).where(Order.order_number == number, Order.user_id == user.id))
    if order is None:
        raise AppError(404, "order_not_found", "Order not found.")
    return order_out(db, order)


def list_orders(db: Session, user: User, page: int, page_size: int) -> OrderPage:
    expire_overdue(db)
    total = db.scalar(select(func.count()).select_from(Order).where(Order.user_id == user.id))
    counts = (
        select(OrderItem.order_id, func.sum(OrderItem.quantity).label("n"))
        .group_by(OrderItem.order_id)
        .subquery()
    )
    rows = db.execute(
        select(Order, counts.c.n)
        .join(counts, counts.c.order_id == Order.id)
        .where(Order.user_id == user.id)
        .order_by(Order.placed_at.desc(), Order.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    return OrderPage(
        items=[
            OrderSummary(
                order_number=o.order_number,
                status=o.status,
                placed_at=o.placed_at,
                item_count=int(n),
                total_cents=o.total_cents,
            )
            for o, n in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
