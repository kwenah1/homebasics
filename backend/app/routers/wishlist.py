"""/api/v1/me/wishlist - WSH-01..04."""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.sweep import release_expired_stock
from app.db import get_db
from app.models import User
from app.schemas.cart import CartOut
from app.schemas.types import PathId
from app.schemas.wishlist import WishlistOut
from app.services import wishlist as wishlist_service

router = APIRouter(
    prefix="/me/wishlist", tags=["wishlist"], dependencies=[Depends(release_expired_stock)]
)


@router.get("", response_model=WishlistOut)
def get_wishlist(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Newest first, with each product's current price and stock."""
    return wishlist_service.get_wishlist(db, user)


@router.put(
    "/{product_id}",
    response_model=WishlistOut,
    responses={409: {"description": "Wishlist full"}},
)
def add(product_id: PathId, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Save a product. Saving one that's already there is fine (idempotent)."""
    return wishlist_service.add(db, user, product_id)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove(
    product_id: PathId, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Idempotent: removing something that isn't there is still 204."""
    wishlist_service.remove(db, user, product_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{product_id}/move-to-cart",
    response_model=CartOut,
    responses={409: {"description": "The cart refused it (out of stock or line limit)"}},
)
def move_to_cart(
    product_id: PathId, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return wishlist_service.move_to_cart(db, user, product_id)
