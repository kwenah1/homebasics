from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.sweep import release_expired_stock
from app.db import get_db
from app.schemas.catalog import CategoryOut, ProductDetail, ProductPage, ProductQuery
from app.services import catalog as catalog_service

router = APIRouter(tags=["catalog"], dependencies=[Depends(release_expired_stock)])


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)) -> list[CategoryOut]:
    """Every category with its count of visible (non-archived) products."""
    return catalog_service.list_categories(db)


@router.get("/products", response_model=ProductPage)
def list_products(
    query: Annotated[ProductQuery, Query()], db: Session = Depends(get_db)
) -> ProductPage:
    """CAT-01..03: browse, search (all keywords must match), filter, sort, paginate."""
    return catalog_service.list_products(db, query)


@router.get("/products/{slug}", response_model=ProductDetail)
def get_product(slug: str, db: Session = Depends(get_db)) -> ProductDetail:
    """CAT-04. Archived or unknown products are 404."""
    return catalog_service.get_product(db, slug)
