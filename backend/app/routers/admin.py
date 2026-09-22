"""/api/v1/admin/* - every route requires an admin (ADM-04). The guard is on the router, so a
new route can't forget it; tests enumerate the OpenAPI spec to prove it."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import require_admin
from app.db import get_db
from app.models import OrderStatus, User
from app.schemas.admin import (
    AdminCategoryOut,
    AdminOrderOut,
    AdminOrderPage,
    AdminProductOut,
    AdminProductPage,
    AdminStatusChange,
    AdminSummary,
    CategoryCreate,
    CategoryUpdate,
    ProductCreate,
    ProductUpdate,
    RefundIn,
    StockAdjustment,
    StockLedger,
)
from app.services import admin as admin_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/summary", response_model=AdminSummary)
def summary(db: Session = Depends(get_db)):
    return admin_service.summary(db)


# --- Products -----------------------------------------------------------------------------


@router.get("/products", response_model=AdminProductPage)
def list_products(
    q: str | None = Query(default=None, max_length=100),
    category_id: int | None = Query(default=None, ge=1),
    archived: Literal["all", "active", "archived"] = "all",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return admin_service.list_products(
        db, q=q, category_id=category_id, archived=archived, page=page, page_size=page_size
    )


@router.post("/products", response_model=AdminProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    data: ProductCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    return admin_service.create_product(db, admin, data)


@router.get("/products/{product_id}", response_model=AdminProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    return admin_service.get_product(db, product_id)


@router.patch("/products/{product_id}", response_model=AdminProductOut)
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(get_db)):
    return admin_service.update_product(db, product_id, data)


@router.post("/products/{product_id}/archive", response_model=AdminProductOut)
def archive(product_id: int, db: Session = Depends(get_db)):
    return admin_service.set_archived(db, product_id, True)


@router.post("/products/{product_id}/unarchive", response_model=AdminProductOut)
def unarchive(product_id: int, db: Session = Depends(get_db)):
    return admin_service.set_archived(db, product_id, False)


@router.post("/products/{product_id}/stock-adjustments", response_model=AdminProductOut)
def adjust_stock(
    product_id: int,
    data: StockAdjustment,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """ADM-02: restock (+), damaged (-) or adjustment (either); never below zero."""
    return admin_service.adjust_stock(db, admin, product_id, data)


@router.get("/products/{product_id}/stock-movements", response_model=StockLedger)
def stock_movements(product_id: int, db: Session = Depends(get_db)):
    return admin_service.stock_ledger(db, product_id)


# --- Categories ----------------------------------------------------------------------------


@router.get("/categories", response_model=list[AdminCategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return admin_service.list_categories(db)


@router.post("/categories", response_model=AdminCategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(data: CategoryCreate, db: Session = Depends(get_db)):
    return admin_service.create_category(db, data)


@router.patch("/categories/{category_id}", response_model=AdminCategoryOut)
def update_category(category_id: int, data: CategoryUpdate, db: Session = Depends(get_db)):
    return admin_service.update_category(db, category_id, data)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    admin_service.delete_category(db, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Orders -----------------------------------------------------------------------------------


@router.get("/orders", response_model=AdminOrderPage)
def list_orders(
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=100, description="Order number or email"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return admin_service.list_orders(db, status=status_filter, q=q, page=page, page_size=page_size)


@router.get("/orders/{order_number}", response_model=AdminOrderOut)
def get_order(order_number: str, db: Session = Depends(get_db)):
    return admin_service.get_order(db, order_number)


@router.post("/orders/{order_number}/status", response_model=AdminOrderOut)
def change_status(
    order_number: str,
    data: AdminStatusChange,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """processing / shipped / delivered / cancelled - via the ORD-02 state machine (409 if
    not allowed). Cancelling returns the stock and refunds a paid order."""
    return admin_service.change_status(db, admin, order_number, data.to, data.note)


@router.post("/orders/{order_number}/refund", response_model=AdminOrderOut)
def refund(
    order_number: str,
    data: RefundIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delivered orders only."""
    return admin_service.refund(db, admin, order_number, data.note)
