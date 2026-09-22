"""Shopping cart: CRT-01..04.

One pure function (``price_lines``) turns (product, quantity, price-when-added) triples into a
``CartOut``; both the saved cart and the guest-cart preview go through it, so they can never
disagree about totals, issues or price-change notices.
"""

from collections import OrderedDict
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload

from app.core.errors import AppError
from app.models import Cart, CartItem, Product, User
from app.schemas.cart import (
    MAX_LINE_QTY,
    CappedLine,
    CartLineOut,
    CartOut,
    GuestItem,
    LineIssue,
    MergeOut,
    MergeReport,
    SkippedLine,
)
from app.schemas.catalog import CategoryRef
from app.services.catalog import max_order_qty, stock_status

FREE_SHIPPING_THRESHOLD_CENTS = 5000  # CHK-03 (display estimate; checkout decides in M5)


# --- Pure rules -----------------------------------------------------------------------------


def line_limit(stock_qty: int) -> int:
    """CRT-01: a line may hold at most min(10, stock) units."""
    return max(0, min(MAX_LINE_QTY, stock_qty))


def line_issue(product: Product, quantity: int) -> tuple[LineIssue | None, int | None]:
    """CRT-04: nothing is reserved, so re-check every line against today's stock."""
    if product.is_archived:
        return "unavailable", None
    if product.stock_qty <= 0:
        return "out_of_stock", None
    if product.stock_qty < quantity:
        return "insufficient_stock", product.stock_qty
    return None, None


def merged_quantity(existing: int, incoming: int, stock_qty: int) -> int:
    """CRT-02: sum, then cap at min(10, stock) - but never *reduce* a line the user already
    had (if stock fell below it, the line is flagged instead)."""
    return max(existing, min(existing + incoming, line_limit(stock_qty)))


def amount_to_free_shipping(subtotal_cents: int) -> int:
    return max(0, FREE_SHIPPING_THRESHOLD_CENTS - subtotal_cents)


@dataclass(frozen=True)
class Line:
    product: Product
    quantity: int
    price_when_added_cents: int


def price_lines(lines: list[Line], unknown_ids: list[int] | None = None) -> CartOut:
    out: list[CartLineOut] = []
    for line in lines:
        p = line.product
        issue, available = line_issue(p, line.quantity)
        status, left = stock_status(p.stock_qty)
        out.append(
            CartLineOut(
                product_id=p.id,
                sku=p.sku,
                slug=p.slug,
                name=p.name,
                category=CategoryRef(slug=p.category.slug, name=p.category.name),
                unit_price_cents=p.price_cents,
                quantity=line.quantity,
                line_total_cents=p.price_cents * line.quantity,
                price_when_added_cents=line.price_when_added_cents,
                price_change_cents=p.price_cents - line.price_when_added_cents,
                stock_status="out_of_stock" if p.is_archived else status,
                stock_left=None if p.is_archived else left,
                max_order_qty=0 if p.is_archived else max_order_qty(p.stock_qty),
                issue=issue,
                available=available,
            )
        )
    subtotal = sum(line.line_total_cents for line in out if line.issue is None)
    return CartOut(
        items=out,
        item_count=sum(line.quantity for line in out),
        subtotal_cents=subtotal,
        has_issues=any(line.issue for line in out),
        has_price_changes=any(line.price_change_cents for line in out),
        free_shipping_threshold_cents=FREE_SHIPPING_THRESHOLD_CENTS,
        amount_to_free_shipping_cents=amount_to_free_shipping(subtotal),
        unknown_product_ids=unknown_ids or [],
    )


def combine_guest_items(items: list[GuestItem]) -> "OrderedDict[int, tuple[int, int | None]]":
    """Duplicate product ids in a guest cart are summed (first price seen wins)."""
    combined: OrderedDict[int, tuple[int, int | None]] = OrderedDict()
    for item in items:
        qty, seen = combined.get(item.product_id, (0, item.price_cents_seen))
        combined[item.product_id] = (qty + item.quantity, seen)
    return combined


# --- Persistence ------------------------------------------------------------------------------


def _locked_cart(db: Session, user: User) -> Cart:
    """Get-or-create the user's cart and lock it, so concurrent requests for the same user
    (double-clicked Add, two tabs) are applied one after another instead of colliding."""
    db.execute(
        insert(Cart).values(user_id=user.id).on_conflict_do_nothing(index_elements=["user_id"])
    )
    return db.scalar(select(Cart).where(Cart.user_id == user.id).with_for_update())


def _lines(db: Session, cart_id: int) -> list[CartItem]:
    return list(
        db.scalars(
            select(CartItem)
            .where(CartItem.cart_id == cart_id)
            .options(joinedload(CartItem.product).joinedload(Product.category))
            .order_by(CartItem.id)
        )
    )


def _view(db: Session, cart_id: int) -> CartOut:
    return price_lines(
        [Line(i.product, i.quantity, i.price_cents_when_added) for i in _lines(db, cart_id)]
    )


def _visible_product(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None or product.is_archived:
        raise AppError(404, "product_not_found", "Product not found.")
    return product


def _line(db: Session, cart_id: int, product_id: int) -> CartItem | None:
    return db.scalar(
        select(CartItem).where(CartItem.cart_id == cart_id, CartItem.product_id == product_id)
    )


def get_cart(db: Session, user: User) -> CartOut:
    cart = db.scalar(select(Cart).where(Cart.user_id == user.id))
    return _view(db, cart.id) if cart else price_lines([])


def add_item(db: Session, user: User, product_id: int, quantity: int) -> CartOut:
    product = _visible_product(db, product_id)
    if product.stock_qty <= 0:
        raise AppError(409, "out_of_stock", "This item is out of stock.")
    cart = _locked_cart(db, user)
    line = _line(db, cart.id, product_id)
    in_cart = line.quantity if line else 0
    limit = line_limit(product.stock_qty)
    if in_cart + quantity > limit:
        raise AppError(
            409,
            "quantity_limit",
            f"You can have at most {limit} of this item in your cart.",
            extra={"max_quantity": limit, "in_cart": in_cart},
        )
    if line:
        line.quantity += quantity
    else:
        db.add(
            CartItem(
                cart_id=cart.id,
                product_id=product_id,
                quantity=quantity,
                price_cents_when_added=product.price_cents,
            )
        )
    db.commit()
    return _view(db, cart.id)


def set_quantity(db: Session, user: User, product_id: int, quantity: int) -> CartOut:
    cart = _locked_cart(db, user)
    line = _line(db, cart.id, product_id)
    if line is None:
        raise AppError(404, "not_in_cart", "That item isn't in your cart.")
    product = line.product
    if product.is_archived:
        raise AppError(409, "product_unavailable", "This item is no longer sold. Remove it.")
    if quantity > product.stock_qty:
        raise AppError(
            409,
            "insufficient_stock",
            f"Only {product.stock_qty} available.",
            extra={"available": product.stock_qty},
        )
    line.quantity = quantity
    db.commit()
    return _view(db, cart.id)


def remove_item(db: Session, user: User, product_id: int) -> CartOut:
    cart = _locked_cart(db, user)
    line = _line(db, cart.id, product_id)
    if line is None:
        raise AppError(404, "not_in_cart", "That item isn't in your cart.")
    db.delete(line)
    db.commit()
    return _view(db, cart.id)


def clear(db: Session, user: User) -> None:
    cart = _locked_cart(db, user)
    db.execute(delete(CartItem).where(CartItem.cart_id == cart.id))
    db.commit()


def acknowledge_prices(db: Session, user: User) -> CartOut:
    """CRT-03: the shopper has seen the new prices; stop flagging them."""
    cart = _locked_cart(db, user)
    for line in _lines(db, cart.id):
        line.price_cents_when_added = line.product.price_cents
    db.commit()
    return _view(db, cart.id)


def preview(db: Session, items: list[GuestItem]) -> CartOut:
    """Price a guest cart with exactly the same rules, without saving anything."""
    combined = combine_guest_items(items)
    products = {
        p.id: p
        for p in db.scalars(
            select(Product).where(Product.id.in_(combined)).options(joinedload(Product.category))
        )
    }
    lines, unknown = [], []
    for product_id, (quantity, seen) in combined.items():
        product = products.get(product_id)
        if product is None:
            unknown.append(product_id)
            continue
        price_seen = seen if seen is not None else product.price_cents
        lines.append(Line(product, min(quantity, MAX_LINE_QTY), price_seen))
    return price_lines(lines, unknown)


def merge(db: Session, user: User, items: list[GuestItem]) -> MergeOut:
    """CRT-02: fold a guest cart into the account cart at sign-in."""
    cart = _locked_cart(db, user)
    capped: list[CappedLine] = []
    skipped: list[SkippedLine] = []

    for product_id, (quantity, seen) in combine_guest_items(items).items():
        product = db.get(Product, product_id)
        if product is None or product.is_archived:
            skipped.append(SkippedLine(product_id=product_id, reason="unavailable"))
            continue
        if product.stock_qty <= 0:
            skipped.append(SkippedLine(product_id=product_id, reason="out_of_stock"))
            continue

        line = _line(db, cart.id, product_id)
        existing = line.quantity if line else 0
        kept = merged_quantity(existing, quantity, product.stock_qty)
        if kept < existing + quantity:
            capped.append(
                CappedLine(product_id=product_id, requested=existing + quantity, kept=kept)
            )
        if line:
            line.quantity = kept  # the account's recorded price is kept (CRT-03)
        else:
            # Record the price the guest actually saw, so a change that happened before they
            # signed in is still flagged (CRT-03). Only ever used for the notice - totals and
            # charges always use today's price.
            db.add(
                CartItem(
                    cart_id=cart.id,
                    product_id=product_id,
                    quantity=kept,
                    price_cents_when_added=seen if seen is not None else product.price_cents,
                )
            )
        db.flush()

    db.commit()
    return MergeOut(cart=_view(db, cart.id), report=MergeReport(capped=capped, skipped=skipped))
