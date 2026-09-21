"""Address book: ACC-05 (max 5 per user, exactly one default when any exist)."""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import AppError
from app.models import Address, TaxRate, User
from app.schemas.user import AddressIn, AddressUpdate


def list_addresses(db: Session, user: User) -> list[Address]:
    return list(
        db.scalars(
            select(Address)
            .where(Address.user_id == user.id)
            .order_by(Address.is_default.desc(), Address.id)
        )
    )


def get_owned(db: Session, user: User, address_id: int) -> Address:
    """Another user's address is reported as 404 - never confirm that it exists."""
    address = db.get(Address, address_id)
    if address is None or address.user_id != user.id:
        raise AppError(404, "address_not_found", "Address not found.")
    return address


def _check_state(db: Session, state: str) -> None:
    if db.get(TaxRate, state) is None:
        raise AppError(
            422,
            "validation_error",
            "Some fields are invalid.",
            fields={"state": "Unknown US state code."},
        )


def _clear_default(db: Session, user_id: int) -> None:
    db.execute(
        update(Address)
        .where(Address.user_id == user_id, Address.is_default)
        .values(is_default=False)
    )
    db.flush()  # must hit the DB before a new default, or the partial unique index trips


def create_address(db: Session, user: User, data: AddressIn) -> Address:
    count = db.scalar(select(func.count()).where(Address.user_id == user.id))
    limit = get_settings().max_addresses
    if count >= limit:
        raise AppError(409, "address_limit_reached", f"You can save up to {limit} addresses.")
    _check_state(db, data.state)

    make_default = data.is_default or count == 0
    if make_default:
        _clear_default(db, user.id)
    address = Address(user_id=user.id, **data.model_dump(exclude={"is_default"}))
    address.is_default = make_default
    db.add(address)
    db.commit()
    return address


def update_address(db: Session, user: User, address_id: int, data: AddressUpdate) -> Address:
    address = get_owned(db, user, address_id)
    changes = data.model_dump(exclude_unset=True)
    for required in ("label", "recipient_name", "line1", "city", "state", "postal_code"):
        if required in changes and changes[required] is None:
            raise AppError(
                422,
                "validation_error",
                "Some fields are invalid.",
                fields={required: "This field is required."},
            )
    if "state" in changes:
        _check_state(db, changes["state"])
    if "line2" in changes:
        changes["line2"] = changes["line2"] or None  # blank clears the line
    for field, value in changes.items():
        setattr(address, field, value)
    db.commit()
    return address


def set_default(db: Session, user: User, address_id: int) -> Address:
    address = get_owned(db, user, address_id)
    if not address.is_default:
        _clear_default(db, user.id)
        address.is_default = True
        db.commit()
    return address


def delete_address(db: Session, user: User, address_id: int) -> None:
    address = get_owned(db, user, address_id)
    was_default = address.is_default
    db.delete(address)
    db.flush()
    if was_default:
        # Promote the oldest remaining address so the user still has a default.
        oldest = db.scalar(
            select(Address).where(Address.user_id == user.id).order_by(Address.id).limit(1)
        )
        if oldest is not None:
            oldest.is_default = True
    db.commit()
