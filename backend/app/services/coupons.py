"""Coupons (CPN-01..06): validation, discount maths, redemptions and admin management.

A use counts only while its order is alive: a cancelled or expired order gives the use back
(CPN-04). Placement locks the coupon row, so two shoppers can't both take the last use.
"""

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import bugs, clock
from app.core.errors import AppError
from app.models import Coupon, CouponKind, CouponRedemption, Order, OrderStatus, User
from app.schemas.coupons import AppliedCoupon, CouponCreate, CouponOut, CouponUpdate

# Orders in these states no longer hold a coupon use.
RELEASED = (OrderStatus.CANCELLED, OrderStatus.EXPIRED)


# --- Pure rules ------------------------------------------------------------------------------


def discount_for(coupon: Coupon, subtotal_cents: int) -> int:
    """CPN-02: percent rounds half-up to the cent; neither kind goes past the subtotal."""
    if coupon.kind == CouponKind.PERCENT:
        raw = Decimal(subtotal_cents) * Decimal(coupon.percent_off) / 100
        amount = int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    else:
        amount = coupon.amount_off_cents
    return min(amount, subtotal_cents)


def state_of(coupon: Coupon, uses: int) -> str:
    now = clock.now()
    if not coupon.is_active:
        return "disabled"
    if coupon.expires_at is not None and now >= coupon.expires_at:
        return "expired"
    if coupon.starts_at is not None and now < coupon.starts_at:
        return "scheduled"
    if coupon.max_redemptions is not None and uses >= coupon.max_redemptions:
        return "exhausted"
    return "active"


def _reject(reason: str, message: str, **extra) -> AppError:
    return AppError(
        422,
        "coupon_rejected",
        message,
        fields={"coupon_code": message},
        extra={"reason": reason, **extra},
    )


# --- Queries ---------------------------------------------------------------------------------


def _live_uses(db: Session, coupon_id: int, user_id: int | None = None) -> int:
    stmt = (
        select(func.count())
        .select_from(CouponRedemption)
        .join(Order, Order.id == CouponRedemption.order_id)
        .where(CouponRedemption.coupon_id == coupon_id, Order.status.not_in(RELEASED))
    )
    if user_id is not None:
        stmt = stmt.where(CouponRedemption.user_id == user_id)
    return db.scalar(stmt)


def evaluate(
    db: Session, user: User, code: str, subtotal_cents: int, *, lock: bool = False
) -> tuple[Coupon, int]:
    """CPN-03: check every rule for this shopper and cart; return (coupon, discount).

    With lock=True (placement) the coupon row is locked first, so the usage counts read
    below can't change until this transaction ends."""
    stmt = select(Coupon).where(Coupon.code == code.strip().upper())
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    coupon = db.scalar(stmt)
    if coupon is None or not coupon.is_active:
        raise _reject("invalid", "That code isn't valid.")

    now = clock.now()
    if coupon.starts_at is not None and now < coupon.starts_at:
        raise _reject("not_started", "That code isn't active yet.")
    if coupon.expires_at is not None and now >= coupon.expires_at:
        raise _reject("expired", "That code has expired.")
    if coupon.max_redemptions is not None and _live_uses(db, coupon.id) >= coupon.max_redemptions:
        raise _reject("exhausted", "That code has been used up.")
    per_user_checked = not bugs.active("coupon_per_user_limit_ignored")
    if per_user_checked and _live_uses(db, coupon.id, user.id) >= coupon.per_user_limit:
        raise _reject("already_used", "You've already used that code.")
    if subtotal_cents < coupon.min_subtotal_cents:
        raise _reject(
            "min_spend",
            f"Spend ${coupon.min_subtotal_cents / 100:.2f} or more to use that code.",
            min_subtotal_cents=coupon.min_subtotal_cents,
            short_by_cents=coupon.min_subtotal_cents - subtotal_cents,
        )
    return coupon, discount_for(coupon, subtotal_cents)


def applied(coupon: Coupon, discount_cents: int) -> AppliedCoupon:
    return AppliedCoupon(
        code=coupon.code, description=coupon.description, discount_cents=discount_cents
    )


def redeem(db: Session, coupon: Coupon, user: User, order: Order) -> None:
    db.add(CouponRedemption(coupon_id=coupon.id, user_id=user.id, order_id=order.id))


# --- Admin (ADM-05) -----------------------------------------------------------------------------


def coupon_out(db: Session, coupon: Coupon) -> CouponOut:
    uses = _live_uses(db, coupon.id)
    return CouponOut(
        id=coupon.id,
        code=coupon.code,
        description=coupon.description,
        kind=coupon.kind,
        percent_off=coupon.percent_off,
        amount_off_cents=coupon.amount_off_cents,
        min_subtotal_cents=coupon.min_subtotal_cents,
        starts_at=coupon.starts_at,
        expires_at=coupon.expires_at,
        max_redemptions=coupon.max_redemptions,
        per_user_limit=coupon.per_user_limit,
        is_active=coupon.is_active,
        uses=uses,
        state=state_of(coupon, uses),
    )


def list_coupons(db: Session) -> list[CouponOut]:
    return [coupon_out(db, c) for c in db.scalars(select(Coupon).order_by(Coupon.code))]


def _get(db: Session, coupon_id: int) -> Coupon:
    coupon = db.get(Coupon, coupon_id)
    if coupon is None:
        raise AppError(404, "coupon_not_found", "Coupon not found.")
    return coupon


def get_coupon(db: Session, coupon_id: int) -> CouponOut:
    return coupon_out(db, _get(db, coupon_id))


def create_coupon(db: Session, data: CouponCreate) -> CouponOut:
    coupon = Coupon(**data.model_dump())
    db.add(coupon)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(
            409, "coupon_code_taken", "That code is already used.", fields={"code": "Already used."}
        ) from None
    db.commit()
    return coupon_out(db, coupon)


def update_coupon(db: Session, coupon_id: int, data: CouponUpdate) -> CouponOut:
    coupon = _get(db, coupon_id)
    changes = data.model_dump(exclude_unset=True)
    # Only these may be cleared (null = no start / no expiry / unlimited).
    for field in ("description", "min_subtotal_cents", "per_user_limit", "is_active"):
        if field in changes and changes[field] is None:
            raise AppError(
                422,
                "validation_error",
                "Some fields are invalid.",
                fields={field: "Can't be empty."},
            )
    starts = changes.get("starts_at", coupon.starts_at)
    expires = changes.get("expires_at", coupon.expires_at)
    if starts is not None and expires is not None and starts >= expires:
        raise AppError(
            422,
            "validation_error",
            "Some fields are invalid.",
            fields={"expires_at": "Expiry must be after the start."},
        )
    for field, value in changes.items():
        setattr(coupon, field, value)
    db.commit()
    return coupon_out(db, coupon)
