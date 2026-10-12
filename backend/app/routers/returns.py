"""Customer returns - RET-01..06. Staff actions live under /admin/returns."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db import get_db
from app.models import User
from app.schemas.common import SafeStr
from app.schemas.returns import ReturnCreate, ReturnOut
from app.services import returns as return_service

router = APIRouter(tags=["returns"])


@router.post(
    "/orders/{order_number}/returns",
    response_model=ReturnOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "Not delivered, or the 30-day window has closed"}},
)
def create_return(
    order_number: SafeStr,
    data: ReturnCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ask to return some or all of a delivered order's items (422 if more than remain)."""
    return return_service.create_return(db, user, order_number, data)


@router.get("/orders/{order_number}/returns", response_model=list[ReturnOut])
def order_returns(
    order_number: SafeStr, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return return_service.list_for_customer(db, user, order_number)


@router.get("/returns", response_model=list[ReturnOut])
def my_returns(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return return_service.list_for_customer(db, user)


@router.get("/returns/{return_number}", response_model=ReturnOut)
def get_return(
    return_number: SafeStr, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return return_service.get_for_customer(db, user, return_number)


@router.post(
    "/returns/{return_number}/cancel",
    response_model=ReturnOut,
    responses={409: {"description": "Already decided or received"}},
)
def cancel_return(
    return_number: SafeStr, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return return_service.cancel(db, user, return_number)
