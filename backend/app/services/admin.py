"""Back office: ADM-01..04. Every function here is reached only through require_admin."""

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.errors import AppError
from app.models import (
    Category,
    InventoryMovement,
    InventoryReason,
    Order,
    OrderItem,
    OrderStatus,
    Payment,
    PaymentStatus,
    Product,
    User,
)
from app.schemas.admin import (
    AdminCategoryOut,
    AdminOrderOut,
    AdminOrderPage,
    AdminOrderSummary,
    AdminProductOut,
    AdminProductPage,
    AdminSummary,
    CategoryCreate,
    CategoryUpdate,
    LowStockItem,
    MovementOut,
    ProductCreate,
    ProductUpdate,
    StockAdjustment,
    StockLedger,
)
from app.seed.run import slugify
from app.services import notifications, order_state
from app.services import orders as order_service
from app.services import returns as return_service
from app.services.catalog import LOW_STOCK_THRESHOLD, escape_like
from app.services.order_state import Actor

# --- Products ---------------------------------------------------------------------------------


def _product_out(p: Product) -> AdminProductOut:
    return AdminProductOut(
        id=p.id,
        sku=p.sku,
        slug=p.slug,
        name=p.name,
        description=p.description,
        price_cents=p.price_cents,
        stock_qty=p.stock_qty,
        is_archived=p.is_archived,
        category_id=p.category_id,
        category_name=p.category.name,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _product(db: Session, product_id: int, *, lock: bool = False) -> Product:
    stmt = select(Product).where(Product.id == product_id).options(joinedload(Product.category))
    if lock:
        stmt = stmt.with_for_update(of=Product).execution_options(populate_existing=True)
    product = db.scalar(stmt)
    if product is None:
        raise AppError(404, "product_not_found", "Product not found.")
    return product


def _category(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise AppError(
            422,
            "validation_error",
            "Some fields are invalid.",
            fields={"category_id": "Unknown category."},
        )
    return category


def list_products(
    db: Session, *, q: str | None, category_id: int | None, archived: str, page: int, page_size: int
) -> AdminProductPage:
    stmt = select(Product).options(joinedload(Product.category))
    if q:
        pattern = f"%{escape_like(q.strip())}%"
        stmt = stmt.where(
            or_(Product.name.ilike(pattern, escape="\\"), Product.sku.ilike(pattern, escape="\\"))
        )
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    if archived == "active":
        stmt = stmt.where(Product.is_archived.is_(False))
    elif archived == "archived":
        stmt = stmt.where(Product.is_archived.is_(True))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = db.scalars(
        stmt.order_by(Product.sku).limit(page_size).offset((page - 1) * page_size)
    ).all()
    return AdminProductPage(
        items=[_product_out(p) for p in rows], total=total, page=page, page_size=page_size
    )


def get_product(db: Session, product_id: int) -> AdminProductOut:
    return _product_out(_product(db, product_id))


def create_product(db: Session, admin: User, data: ProductCreate) -> AdminProductOut:
    _category(db, data.category_id)
    slug = slugify(data.name)
    if db.scalar(select(Product.id).where(Product.sku == data.sku)):
        raise AppError(
            409, "sku_taken", "That SKU is already used.", fields={"sku": "Already used."}
        )
    if db.scalar(select(Product.id).where(Product.slug == slug)):
        raise AppError(
            409,
            "name_taken",
            "A product with that name already exists.",
            fields={"name": "Choose a name no other product uses."},
        )
    product = Product(
        category_id=data.category_id,
        sku=data.sku,
        name=data.name,
        slug=slug,
        description=data.description,
        price_cents=data.price_cents,
        stock_qty=data.initial_stock,
    )
    db.add(product)
    try:
        db.flush()
    except IntegrityError as exc:  # a concurrent create won the race for the same SKU/slug
        db.rollback()
        raise AppError(409, "sku_taken", "That SKU or name is already used.") from exc
    if data.initial_stock:
        db.add(
            InventoryMovement(
                product_id=product.id,
                delta=data.initial_stock,
                reason=InventoryReason.INITIAL,
                actor_user_id=admin.id,
            )
        )
    db.commit()
    return get_product(db, product.id)


def update_product(db: Session, product_id: int, data: ProductUpdate) -> AdminProductOut:
    product = _product(db, product_id, lock=True)
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    if "category_id" in changes:
        _category(db, changes["category_id"])
    for field, value in changes.items():
        setattr(product, field, value)  # slug deliberately untouched: links keep working
    db.commit()
    return get_product(db, product_id)


def set_archived(db: Session, product_id: int, archived: bool) -> AdminProductOut:
    """ADM-01: archived products vanish from the storefront but stay on existing orders."""
    product = _product(db, product_id, lock=True)
    product.is_archived = archived
    db.commit()
    return get_product(db, product_id)


# --- Stock (ADM-02) ------------------------------------------------------------------------------


def adjust_stock(
    db: Session, admin: User, product_id: int, data: StockAdjustment
) -> AdminProductOut:
    if data.delta == 0:
        raise AppError(
            422, "validation_error", "Some fields are invalid.", fields={"delta": "Must not be 0."}
        )
    if data.reason == "restock" and data.delta < 0:
        raise AppError(
            422,
            "validation_error",
            "Some fields are invalid.",
            fields={"delta": "A restock adds stock."},
        )
    if data.reason == "damaged" and data.delta > 0:
        raise AppError(
            422,
            "validation_error",
            "Some fields are invalid.",
            fields={"delta": "Damaged stock is removed."},
        )

    product = _product(db, product_id, lock=True)  # same lock checkout takes
    if product.stock_qty + data.delta < 0:
        raise AppError(
            409,
            "insufficient_stock",
            f"Only {product.stock_qty} in stock; can't remove {-data.delta}.",
            extra={"available": product.stock_qty},
        )
    before = product.stock_qty
    product.stock_qty = Product.stock_qty + data.delta  # relative update (see orders.py)
    notifications.stock_changed(db, product, before, before + data.delta)
    db.add(
        InventoryMovement(
            product_id=product.id,
            delta=data.delta,
            reason=InventoryReason(data.reason),
            actor_user_id=admin.id,
            note=data.note,
        )
    )
    db.commit()
    return get_product(db, product_id)


def stock_ledger(db: Session, product_id: int, limit: int = 100) -> StockLedger:
    product = _product(db, product_id)
    rows = db.execute(
        select(InventoryMovement, Order.order_number, User.email)
        .outerjoin(Order, Order.id == InventoryMovement.order_id)
        .outerjoin(User, User.id == InventoryMovement.actor_user_id)
        .where(InventoryMovement.product_id == product_id)
        .order_by(InventoryMovement.id.desc())
        .limit(limit)
    ).all()
    total = db.scalar(
        select(func.coalesce(func.sum(InventoryMovement.delta), 0)).where(
            InventoryMovement.product_id == product_id
        )
    )
    return StockLedger(
        product_id=product.id,
        stock_qty=product.stock_qty,
        ledger_total=total,
        movements=[
            MovementOut(
                id=m.id,
                delta=m.delta,
                reason=m.reason,
                order_number=number,
                actor_email=email,
                note=m.note,
                created_at=m.created_at,
            )
            for m, number, email in rows
        ],
    )


# --- Categories --------------------------------------------------------------------------------


def list_categories(db: Session) -> list[AdminCategoryOut]:
    active = func.count(Product.id).filter(Product.is_archived.is_(False))
    archived = func.count(Product.id).filter(Product.is_archived.is_(True))
    rows = db.execute(
        select(Category, active, archived)
        .outerjoin(Product, Product.category_id == Category.id)
        .group_by(Category.id)
        .order_by(Category.name)
    ).all()
    return [
        AdminCategoryOut(
            id=c.id,
            name=c.name,
            slug=c.slug,
            description=c.description,
            active_products=a,
            archived_products=z,
        )
        for c, a, z in rows
    ]


def _category_out(db: Session, category_id: int) -> AdminCategoryOut:
    return next(c for c in list_categories(db) if c.id == category_id)


def create_category(db: Session, data: CategoryCreate) -> AdminCategoryOut:
    slug = slugify(data.name)
    clash = db.scalar(
        select(Category.id).where(
            or_(func.lower(Category.name) == data.name.lower(), Category.slug == slug)
        )
    )
    if clash:
        raise AppError(
            409,
            "category_exists",
            "A category with that name exists.",
            fields={"name": "Already used."},
        )
    category = Category(name=data.name, slug=slug, description=data.description)
    db.add(category)
    db.commit()
    return _category_out(db, category.id)


def update_category(db: Session, category_id: int, data: CategoryUpdate) -> AdminCategoryOut:
    category = db.get(Category, category_id)
    if category is None:
        raise AppError(404, "category_not_found", "Category not found.")
    if data.name is not None:
        clash = db.scalar(
            select(Category.id).where(
                func.lower(Category.name) == data.name.lower(), Category.id != category_id
            )
        )
        if clash:
            raise AppError(
                409,
                "category_exists",
                "A category with that name exists.",
                fields={"name": "Already used."},
            )
        category.name = data.name  # slug stays: storefront links keep working
    if data.description is not None:
        category.description = data.description or None
    db.commit()
    return _category_out(db, category_id)


def delete_category(db: Session, category_id: int) -> None:
    category = db.get(Category, category_id)
    if category is None:
        raise AppError(404, "category_not_found", "Category not found.")
    if db.scalar(
        select(func.count()).select_from(Product).where(Product.category_id == category_id)
    ):
        raise AppError(409, "category_not_empty", "Move or archive this category's products first.")
    db.delete(category)
    db.commit()


# --- Orders (ADM-03) ------------------------------------------------------------------------------


def list_orders(
    db: Session, *, status: OrderStatus | None, q: str | None, page: int, page_size: int
) -> AdminOrderPage:
    order_service.expire_overdue(db)
    counts = (
        select(OrderItem.order_id, func.sum(OrderItem.quantity).label("n"))
        .group_by(OrderItem.order_id)
        .subquery()
    )
    stmt = (
        select(Order, User.email, counts.c.n)
        .join(User, User.id == Order.user_id)
        .join(counts, counts.c.order_id == Order.id)
    )
    if status:
        stmt = stmt.where(Order.status == status)
    if q:
        pattern = f"%{escape_like(q.strip())}%"
        stmt = stmt.where(
            or_(
                Order.order_number.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.execute(
        stmt.order_by(Order.placed_at.desc(), Order.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    return AdminOrderPage(
        items=[
            AdminOrderSummary(
                order_number=o.order_number,
                status=o.status,
                placed_at=o.placed_at,
                customer_email=email,
                item_count=int(n),
                total_cents=o.total_cents,
            )
            for o, email, n in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


def _order_for_update(db: Session, number: str) -> Order:
    from sqlalchemy.orm import selectinload

    order = db.scalar(
        select(Order)
        .where(Order.order_number == number)
        .options(selectinload(Order.items))
        .with_for_update(of=Order)
        .execution_options(populate_existing=True)
    )
    if order is None:
        raise AppError(404, "order_not_found", "Order not found.")
    return order


def admin_order_out(db: Session, order: Order) -> AdminOrderOut:
    base = order_service.order_out(db, order)
    customer = db.get(User, order.user_id)
    return AdminOrderOut(
        **base.model_dump(),
        customer_email=customer.email,
        customer_name=f"{customer.first_name} {customer.last_name}",
        next_statuses=[
            target
            for target in order_state.TRANSITIONS[order.status]
            if order_state.allowed(order.status, target, Actor.ADMIN)
        ],
    )


def get_order(db: Session, number: str) -> AdminOrderOut:
    order_service.expire_overdue(db)
    order = db.scalar(select(Order).where(Order.order_number == number))
    if order is None:
        raise AppError(404, "order_not_found", "Order not found.")
    return admin_order_out(db, order)


def _refund_payment(db: Session, order: Order) -> bool:
    """Refund whatever hasn't been refunded yet (returns may already have refunded part)."""
    paid = db.scalar(
        select(Payment).where(
            Payment.order_id == order.id, Payment.status == PaymentStatus.SUCCEEDED
        )
    )
    if paid is None:
        return False
    refunded = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
            Payment.order_id == order.id, Payment.status == PaymentStatus.REFUNDED
        )
    )
    remaining = paid.amount_cents - refunded
    if remaining > 0:
        db.add(
            Payment(
                order_id=order.id,
                idempotency_key=f"refund:{order.id}",
                amount_cents=remaining,
                status=PaymentStatus.REFUNDED,
                card_last4=paid.card_last4,
            )
        )
    return True


def change_status(
    db: Session, admin: User, number: str, target: str, note: str | None
) -> AdminOrderOut:
    order = _order_for_update(db, number)
    target_status = OrderStatus(target)
    order_state.check(order.status, target_status, Actor.ADMIN)
    refunded = False
    if target_status == OrderStatus.CANCELLED:
        refunded = _refund_payment(db, order)
    suffix = "; payment refunded" if refunded else ""
    order_service.transition(
        db,
        order,
        target_status,
        Actor.ADMIN,
        actor_user_id=admin.id,
        note=(note or f"{target_status.value.replace('_', ' ').capitalize()} by staff") + suffix,
    )
    db.commit()
    return admin_order_out(db, order)


def refund(db: Session, admin: User, number: str, note: str | None) -> AdminOrderOut:
    """Delivered -> refunded, goods kept by the customer. Refunds what returns haven't."""
    order = _order_for_update(db, number)
    order_state.check(order.status, OrderStatus.REFUNDED, Actor.ADMIN)
    if return_service.has_open_return(db, order.id):
        raise AppError(
            409,
            "return_in_progress",
            "Finish (receive, reject or cancel) the open return before refunding the order.",
        )
    _refund_payment(db, order)
    order_service.transition(
        db,
        order,
        OrderStatus.REFUNDED,
        Actor.ADMIN,
        actor_user_id=admin.id,
        note=note or "Refunded by staff",
    )
    db.commit()
    return admin_order_out(db, order)


# --- Dashboard ------------------------------------------------------------------------------------


def summary(db: Session) -> AdminSummary:
    order_service.expire_overdue(db)
    by_status = dict(db.execute(select(Order.status, func.count()).group_by(Order.status)).all())
    counts = {s.value: by_status.get(s, 0) for s in OrderStatus}
    low = db.scalars(
        select(Product)
        .where(Product.is_archived.is_(False), Product.stock_qty <= LOW_STOCK_THRESHOLD)
        .order_by(Product.stock_qty, Product.sku)
    ).all()
    return AdminSummary(
        orders_by_status=counts,
        awaiting_fulfilment=counts["paid"] + counts["processing"],
        low_stock=[
            LowStockItem(id=p.id, sku=p.sku, name=p.name, stock_qty=p.stock_qty) for p in low
        ],
    )
