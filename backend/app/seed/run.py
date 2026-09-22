"""Seed the database.  Usage:  python -m app.seed.run [--reset]"""

import argparse

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db import new_session
from app.models import (
    Base,
    Category,
    Coupon,
    InventoryMovement,
    InventoryReason,
    Product,
    TaxRate,
    User,
    UserRole,
)
from app.seed import data


def slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    return "-".join(part for part in cleaned.split("-") if part)


def truncate_all(db: Session) -> None:
    tables = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
    db.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))  # noqa: S608


def seed(db: Session) -> dict[str, int]:
    """Insert seed data. Assumes empty tables (call truncate_all first)."""
    db.add_all(TaxRate(state_code=c, state_name=n, rate=r) for c, n, r in data.TAX_RATES)

    for u in data.USERS:
        db.add(
            User(
                email=u["email"],
                first_name=u["first_name"],
                last_name=u["last_name"],
                role=UserRole(u["role"]),
                password_hash=hash_password(data.SEED_PASSWORDS[u["email"]]),
            )
        )

    categories = {
        slug: Category(name=name, slug=slug, description=desc)
        for name, slug, desc in data.CATEGORIES
    }
    db.add_all(categories.values())
    db.flush()

    rows = [(p, False) for p in data.PRODUCTS] + [(p, True) for p in data.ARCHIVED_PRODUCTS]
    for position, ((cat_slug, sku, name, price, stock, desc), archived) in enumerate(rows):
        rating_avg, rating_count = data.seed_rating(position)
        product = Product(
            rating_avg=rating_avg,
            rating_count=rating_count,
            rating_total=data.seed_rating_total(rating_avg, rating_count),
            category_id=categories[cat_slug].id,
            sku=sku,
            name=name,
            slug=slugify(name),
            description=desc,
            price_cents=price,
            stock_qty=stock,
            is_archived=archived,
        )
        db.add(product)
        db.flush()
        if stock:
            db.add(
                InventoryMovement(
                    product_id=product.id, delta=stock, reason=InventoryReason.INITIAL
                )
            )

    db.add_all(Coupon(**c) for c in data.COUPONS)

    db.commit()
    return {
        "tax_rates": len(data.TAX_RATES),
        "users": len(data.USERS),
        "categories": len(categories),
        "products": len(rows),
        "coupons": len(data.COUPONS),
    }


def reset_and_seed(db: Session) -> dict[str, int]:
    truncate_all(db)
    return seed(db)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="truncate all tables first")
    args = parser.parse_args()

    with new_session() as db:
        if args.reset:
            counts = reset_and_seed(db)
        elif db.scalar(select(Category.id).limit(1)) is not None:
            print("Database already seeded - use --reset to wipe and reseed.")
            return
        else:
            counts = seed(db)
    print("Seeded:", ", ".join(f"{k}={v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
