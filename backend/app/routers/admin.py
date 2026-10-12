"""/api/v1/admin/* - every route requires an admin (ADM-04). The guard is on the router, so a
new route can't forget it; tests enumerate the OpenAPI spec to prove it."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import require_admin
from app.db import get_db
from app.models import OrderStatus, ReturnStatus, User
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
from app.schemas.common import SafeStr
from app.schemas.coupons import CouponCreate, CouponOut, CouponUpdate
from app.schemas.returns import AdminReturnOut, ReceiveIn, RejectIn, StaffNote
from app.schemas.reviews import AdminReviewPage
from app.schemas.types import PathId, QueryId
from app.services import admin as admin_service
from app.services import coupons as coupon_service
from app.services import returns as return_service
from app.services import reviews as review_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/summary", response_model=AdminSummary)
def summary(db: Session = Depends(get_db)):
    return admin_service.summary(db)


# --- Products -----------------------------------------------------------------------------


@router.get("/products", response_model=AdminProductPage)
def list_products(
    q: SafeStr | None = Query(default=None, max_length=100),
    category_id: QueryId = None,
    archived: Literal["all", "active", "archived"] = "all",
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return admin_service.list_products(
        db, q=q, category_id=category_id, archived=archived, page=page, page_size=page_size
    )


@router.post(
    "/products",
    response_model=AdminProductOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "SKU or name already used"}},
)
def create_product(
    data: ProductCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    return admin_service.create_product(db, admin, data)


@router.get("/products/{product_id}", response_model=AdminProductOut)
def get_product(product_id: PathId, db: Session = Depends(get_db)):
    return admin_service.get_product(db, product_id)


@router.patch(
    "/products/{product_id}",
    response_model=AdminProductOut,
    responses={409: {"description": "Name already used"}},
)
def update_product(product_id: PathId, data: ProductUpdate, db: Session = Depends(get_db)):
    return admin_service.update_product(db, product_id, data)


@router.post("/products/{product_id}/archive", response_model=AdminProductOut)
def archive(product_id: PathId, db: Session = Depends(get_db)):
    return admin_service.set_archived(db, product_id, True)


@router.post("/products/{product_id}/unarchive", response_model=AdminProductOut)
def unarchive(product_id: PathId, db: Session = Depends(get_db)):
    return admin_service.set_archived(db, product_id, False)


@router.post(
    "/products/{product_id}/stock-adjustments",
    response_model=AdminProductOut,
    responses={409: {"description": "Would take stock below zero"}},
)
def adjust_stock(
    product_id: PathId,
    data: StockAdjustment,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """ADM-02: restock (+), damaged (-) or adjustment (either); never below zero."""
    return admin_service.adjust_stock(db, admin, product_id, data)


@router.get("/products/{product_id}/stock-movements", response_model=StockLedger)
def stock_movements(product_id: PathId, db: Session = Depends(get_db)):
    return admin_service.stock_ledger(db, product_id)


# --- Categories ----------------------------------------------------------------------------


@router.get("/categories", response_model=list[AdminCategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return admin_service.list_categories(db)


@router.post(
    "/categories",
    response_model=AdminCategoryOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "Name already used"}},
)
def create_category(data: CategoryCreate, db: Session = Depends(get_db)):
    return admin_service.create_category(db, data)


@router.patch(
    "/categories/{category_id}",
    response_model=AdminCategoryOut,
    responses={409: {"description": "Name already used"}},
)
def update_category(category_id: PathId, data: CategoryUpdate, db: Session = Depends(get_db)):
    return admin_service.update_category(db, category_id, data)


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={409: {"description": "Category still has products"}},
)
def delete_category(category_id: PathId, db: Session = Depends(get_db)):
    admin_service.delete_category(db, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Orders -----------------------------------------------------------------------------------


@router.get("/orders", response_model=AdminOrderPage)
def list_orders(
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    q: SafeStr | None = Query(default=None, max_length=100, description="Order number or email"),
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return admin_service.list_orders(db, status=status_filter, q=q, page=page, page_size=page_size)


@router.get("/orders/{order_number}", response_model=AdminOrderOut)
def get_order(order_number: SafeStr, db: Session = Depends(get_db)):
    return admin_service.get_order(db, order_number)


@router.post(
    "/orders/{order_number}/status",
    response_model=AdminOrderOut,
    responses={409: {"description": "Transition not allowed from the current status"}},
)
def change_status(
    order_number: SafeStr,
    data: AdminStatusChange,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """processing / shipped / delivered / cancelled - via the ORD-02 state machine (409 if
    not allowed). Cancelling returns the stock and refunds a paid order."""
    return admin_service.change_status(db, admin, order_number, data.to, data.note)


@router.post(
    "/orders/{order_number}/refund",
    response_model=AdminOrderOut,
    responses={409: {"description": "Not delivered, or a return is still open"}},
)
def refund(
    order_number: SafeStr,
    data: RefundIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delivered orders only."""
    return admin_service.refund(db, admin, order_number, data.note)


# --- Coupons (ADM-05) ---------------------------------------------------------------------------


@router.get("/coupons", response_model=list[CouponOut])
def list_coupons(db: Session = Depends(get_db)):
    return coupon_service.list_coupons(db)


@router.post(
    "/coupons",
    response_model=CouponOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "Code already used"}},
)
def create_coupon(data: CouponCreate, db: Session = Depends(get_db)):
    return coupon_service.create_coupon(db, data)


@router.get("/coupons/{coupon_id}", response_model=CouponOut)
def get_coupon(coupon_id: PathId, db: Session = Depends(get_db)):
    return coupon_service.get_coupon(db, coupon_id)


@router.patch("/coupons/{coupon_id}", response_model=CouponOut)
def update_coupon(coupon_id: PathId, data: CouponUpdate, db: Session = Depends(get_db)):
    """Code, kind and amount can't change (orders refer to them); disable instead."""
    return coupon_service.update_coupon(db, coupon_id, data)


# --- Reviews (ADM-06: moderation) ---------------------------------------------------------------


@router.get("/reviews", response_model=AdminReviewPage)
def list_reviews(
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return review_service.admin_list(db, page, page_size)


@router.delete("/reviews/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(review_id: PathId, db: Session = Depends(get_db)):
    """Remove an abusive review; the product's rating is recalculated without it."""
    review_service.admin_delete(db, review_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Returns (ADM-07) -----------------------------------------------------------------------------

_RETURN_CONFLICT = {409: {"description": "Not allowed from the return's current status"}}


@router.get("/returns", response_model=list[AdminReturnOut])
def list_returns(
    status_filter: ReturnStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    """Newest first; filter with ?status=requested to see what needs a decision."""
    return return_service.admin_list(db, status_filter)


@router.get("/returns/{return_number}", response_model=AdminReturnOut)
def get_return(return_number: SafeStr, db: Session = Depends(get_db)):
    return return_service.admin_get(db, return_number)


@router.post(
    "/returns/{return_number}/approve", response_model=AdminReturnOut, responses=_RETURN_CONFLICT
)
def approve_return(return_number: SafeStr, data: StaffNote, db: Session = Depends(get_db)):
    return return_service.approve(db, return_number, data.note)


@router.post(
    "/returns/{return_number}/reject", response_model=AdminReturnOut, responses=_RETURN_CONFLICT
)
def reject_return(return_number: SafeStr, data: RejectIn, db: Session = Depends(get_db)):
    """A reason is required - it's emailed to the shopper."""
    return return_service.reject(db, return_number, data.note)


@router.post(
    "/returns/{return_number}/receive", response_model=AdminReturnOut, responses=_RETURN_CONFLICT
)
def receive_return(
    return_number: SafeStr,
    data: ReceiveIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Goods are back: refund their paid share and restock them if sellable (RET-04)."""
    return return_service.receive(db, admin, return_number, data)
