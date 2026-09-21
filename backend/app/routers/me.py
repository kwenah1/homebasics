from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db import get_db
from app.models import User
from app.routers.auth import start_session
from app.schemas.auth import TokenOut
from app.schemas.user import (
    AddressIn,
    AddressOut,
    AddressUpdate,
    PasswordChange,
    ProfileUpdate,
    UserOut,
)
from app.services import addresses as address_service
from app.services import auth as auth_service

router = APIRouter(prefix="/me", tags=["account"])


@router.get("", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("", response_model=UserOut)
def update_me(
    data: ProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> User:
    """ACC-05. Only names are editable; email and role are not (extra fields -> 422)."""
    for field, value in data.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(user, field, value)
    db.commit()
    return user


@router.post("/password", response_model=TokenOut)
def change_password(
    data: PasswordChange,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TokenOut:
    """Signs out every session, then starts a fresh one for this device.

    (The refresh cookie is scoped to /api/v1/auth, so it never reaches this endpoint -
    we can't tell which old session is "this" one; issuing a new one is simpler and safer.)
    """
    auth_service.change_password(db, user, data.current_password, data.new_password)
    return start_session(db, response, user)


# --- Address book (ACC-05) -------------------------------------------------------------


@router.get("/addresses", response_model=list[AddressOut])
def list_addresses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return address_service.list_addresses(db, user)


@router.post("/addresses", response_model=AddressOut, status_code=status.HTTP_201_CREATED)
def create_address(
    data: AddressIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return address_service.create_address(db, user, data)


@router.patch("/addresses/{address_id}", response_model=AddressOut)
def update_address(
    address_id: int,
    data: AddressUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return address_service.update_address(db, user, address_id, data)


@router.post("/addresses/{address_id}/default", response_model=AddressOut)
def make_default(
    address_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return address_service.set_default(db, user, address_id)


@router.delete("/addresses/{address_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_address(
    address_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    address_service.delete_address(db, user, address_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
