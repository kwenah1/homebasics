from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models import UserRole
from app.schemas.common import NewPassword, PersonName, StrictModel


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    first_name: str
    last_name: str
    role: UserRole
    created_at: datetime


class ProfileUpdate(StrictModel):
    first_name: PersonName | None = None
    last_name: PersonName | None = None


class PasswordChange(StrictModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: NewPassword


Line = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
OptLine = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
StateCode = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{2}$")
]
PostalCode = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{5}(-\d{4})?$")]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class AddressIn(StrictModel):
    label: Label = "Home"
    recipient_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
    ]
    line1: Line
    line2: OptLine | None = None
    city: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    state: StateCode
    postal_code: PostalCode
    is_default: bool = False

    @field_validator("line2")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return value or None


class AddressUpdate(StrictModel):
    label: Label | None = None
    recipient_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
        | None
    ) = None
    line1: Line | None = None
    line2: OptLine | None = None
    city: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
        | None
    ) = None
    state: StateCode | None = None
    postal_code: PostalCode | None = None


class AddressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    recipient_name: str
    line1: str
    line2: str | None
    city: str
    state: str
    postal_code: str
    is_default: bool
