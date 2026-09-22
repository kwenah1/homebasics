from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.sweep import release_expired_stock
from app.db import get_db
from app.models import User
from app.schemas.cart import CartItemIn, CartItemUpdate, CartOut, GuestCartIn, MergeOut
from app.schemas.types import PathId
from app.services import cart as cart_service

router = APIRouter(prefix="/cart", tags=["cart"], dependencies=[Depends(release_expired_stock)])


@router.get("", response_model=CartOut)
def get_cart(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return cart_service.get_cart(db, user)


@router.post(
    "/items",
    response_model=CartOut,
    responses={
        404: {"description": "No such product"},
        409: {"description": "Out of stock or over the line limit"},
    },
)
def add_item(
    data: CartItemIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Adds to any quantity already in the cart. 409 quantity_limit if it would exceed
    min(10, stock); 409 out_of_stock; 404 for unknown/archived products."""
    return cart_service.add_item(db, user, data.product_id, data.quantity)


@router.patch(
    "/items/{product_id}",
    response_model=CartOut,
    responses={409: {"description": "Not enough stock, or product unavailable"}},
)
def set_quantity(
    product_id: PathId,
    data: CartItemUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return cart_service.set_quantity(db, user, product_id, data.quantity)


@router.delete("/items/{product_id}", response_model=CartOut)
def remove_item(
    product_id: PathId, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return cart_service.remove_item(db, user, product_id)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_cart(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cart_service.clear(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/acknowledge-prices", response_model=CartOut)
def acknowledge_prices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """CRT-03: stop flagging price changes the shopper has now seen."""
    return cart_service.acknowledge_prices(db, user)


@router.post("/merge", response_model=MergeOut)
def merge(data: GuestCartIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """CRT-02: fold the browser's guest cart into this account's cart at sign-in."""
    return cart_service.merge(db, user, data.items)


@router.post("/preview", response_model=CartOut)
def preview(data: GuestCartIn, db: Session = Depends(get_db)):
    """Public: price a guest cart with the same rules as a saved cart. Nothing is stored."""
    return cart_service.preview(db, data.items)
