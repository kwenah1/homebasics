"""Storefront catalog: CAT-01..05. Archived products are never visible here (ADM-01)."""

import math

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core import bugs
from app.core.errors import AppError
from app.models import Category, Product
from app.schemas.catalog import (
    CategoryOut,
    CategoryRef,
    ImageOut,
    ProductDetail,
    ProductPage,
    ProductQuery,
    ProductSort,
    ProductSummary,
    StockStatus,
)

LOW_STOCK_THRESHOLD = 5  # CAT-05
MAX_LINE_QTY = 10  # CRT-01
MAX_TERMS = 8


# --- Pure rules (unit-tested without a database) ------------------------------------------


def stock_status(stock_qty: int) -> tuple[StockStatus, int | None]:
    """CAT-05: 0 -> out of stock; 1..5 -> 'Only X left'; otherwise just 'in stock'."""
    if stock_qty <= 0:
        return "out_of_stock", None
    if stock_qty <= LOW_STOCK_THRESHOLD - bugs.active("low_stock_threshold_off_by_one"):
        return "low_stock", stock_qty
    return "in_stock", None


def max_order_qty(stock_qty: int) -> int:
    return max(0, min(MAX_LINE_QTY + bugs.active("cart_allows_eleven"), stock_qty))


def search_terms(q: str | None) -> list[str]:
    """Split keywords on whitespace; every term must match (AND). Extra terms are ignored."""
    if not q:
        return []
    return q.split()[:MAX_TERMS]


def escape_like(term: str) -> str:
    """Make %, _ and \\ literal inside a LIKE pattern (a '%' search must not match all)."""
    if bugs.active("search_wildcards_unescaped"):
        return term
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def page_count(total: int, page_size: int) -> int:
    return math.ceil(total / page_size) if total else 0


# --- Queries --------------------------------------------------------------------------------

_SEARCHABLE = Product.name + " " + Product.description

_ORDER_BY = {
    # COLLATE "C": byte-order sorting, identical on every server. Without it the order
    # depended on the database locale (Neon: C; the CI postgres image: en_US.utf8, which
    # ignores spaces/punctuation) - CI caught the difference.
    ProductSort.NAME: (func.lower(Product.name).collate("C"), Product.id),
    ProductSort.PRICE_ASC: (Product.price_cents, Product.id),
    ProductSort.PRICE_DESC: (Product.price_cents.desc(), Product.id),
    ProductSort.NEWEST: (Product.created_at.desc(), Product.id.desc()),
    # Unrated products last; more reviews wins a tie; id keeps pages stable.
    ProductSort.RATING: (
        Product.rating_avg.desc().nulls_last(),
        Product.rating_count.desc(),
        Product.id,
    ),
}


def _visible() -> Select:
    if bugs.active("archived_products_listed"):
        return select(Product)
    return select(Product).where(Product.is_archived.is_(False))


def list_categories(db: Session) -> list[CategoryOut]:
    counts = (
        select(Product.category_id, func.count().label("n"))
        .where(Product.is_archived.is_(False))
        .group_by(Product.category_id)
        .subquery()
    )
    rows = db.execute(
        select(Category, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.category_id == Category.id)
        .order_by(Category.name)
    ).all()
    return [
        CategoryOut(id=c.id, slug=c.slug, name=c.name, description=c.description, product_count=n)
        for c, n in rows
    ]


def _summary(p: Product) -> dict:
    status, left = stock_status(p.stock_qty)
    return {
        "id": p.id,
        "sku": p.sku,
        "slug": p.slug,
        "name": p.name,
        "price_cents": p.price_cents,
        "category": CategoryRef(slug=p.category.slug, name=p.category.name),
        "stock_status": status,
        "stock_left": left,
        "rating_avg": float(p.rating_avg) if p.rating_avg is not None else None,
        "rating_count": p.rating_count,
    }


def list_products(db: Session, query: ProductQuery) -> ProductPage:
    stmt = _visible()

    if query.category:
        category_id = db.scalar(select(Category.id).where(Category.slug == query.category))
        if category_id is None:
            raise AppError(404, "category_not_found", "Category not found.")
        stmt = stmt.where(Product.category_id == category_id)
    for term in search_terms(query.q):
        stmt = stmt.where(_SEARCHABLE.ilike(f"%{escape_like(term)}%", escape="\\"))
    if query.min_price_cents is not None:
        stmt = stmt.where(Product.price_cents >= query.min_price_cents)
    if query.max_price_cents is not None:
        stmt = stmt.where(Product.price_cents <= query.max_price_cents)
    if query.in_stock:
        stmt = stmt.where(Product.stock_qty > 0)

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    products = db.scalars(
        stmt.options(joinedload(Product.category))
        .order_by(*_ORDER_BY[query.sort])
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size)
    ).all()

    return ProductPage(
        items=[ProductSummary(**_summary(p)) for p in products],
        total=total,
        page=query.page,
        page_size=query.page_size,
        pages=page_count(total, query.page_size),
    )


def get_product(db: Session, slug: str) -> ProductDetail:
    product = db.scalar(
        _visible()
        .where(Product.slug == slug)
        .options(joinedload(Product.category), selectinload(Product.images))
    )
    if product is None:
        raise AppError(404, "product_not_found", "Product not found.")
    return ProductDetail(
        **_summary(product),
        description=product.description,
        images=[ImageOut.model_validate(i) for i in product.images],
        max_order_qty=max_order_qty(product.stock_qty),
    )
