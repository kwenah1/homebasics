"""Test oracle: an independent, obviously-correct model of the catalog rules computed from the
seed data in plain Python. API results must equal what this predicts.

Assumes a freshly seeded DB, so product ids are 1..N in PRODUCTS order (tie-breaks use id).
"""

import math
from dataclasses import dataclass
from decimal import Decimal

from app.seed import data


@dataclass(frozen=True)
class SeedProduct:
    id: int
    category: str
    sku: str
    name: str
    price_cents: int
    stock_qty: int
    description: str
    rating_avg: Decimal | None
    rating_count: int


ACTIVE: list[SeedProduct] = [
    SeedProduct(i + 1, cat, sku, name, price, stock, desc, *data.seed_rating(i))
    for i, (cat, sku, name, price, stock, desc) in enumerate(data.PRODUCTS)
]


def matches(p: SeedProduct, *, category=None, q=None, min_price=None, max_price=None,
            in_stock=False) -> bool:  # fmt: skip
    haystack = f"{p.name} {p.description}".lower()
    return (
        (category is None or p.category == category)
        and all(term.lower() in haystack for term in (q or "").split()[:8])
        and (min_price is None or p.price_cents >= min_price)
        and (max_price is None or p.price_cents <= max_price)
        and (not in_stock or p.stock_qty > 0)
    )


SORT_KEYS = {
    "name": lambda p: (p.name.lower(), p.id),
    "price_asc": lambda p: (p.price_cents, p.id),
    "price_desc": lambda p: (-p.price_cents, p.id),
    "newest": lambda p: -p.id,  # all seeded in one transaction: same created_at
    "rating": lambda p: (
        p.rating_avg is None,
        -(p.rating_avg or 0),
        -p.rating_count,
        p.id,
    ),
}


def expected_page(sort="name", page=1, page_size=20, **filters):
    hits = sorted((p for p in ACTIVE if matches(p, **filters)), key=SORT_KEYS[sort])
    start = (page - 1) * page_size
    return {
        "skus": [p.sku for p in hits[start : start + page_size]],
        "total": len(hits),
        "pages": math.ceil(len(hits) / page_size) if hits else 0,
    }
