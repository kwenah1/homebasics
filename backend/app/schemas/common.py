from typing import Annotated

import email_validator
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    StringConstraints,
    field_validator,
)

from app.config import get_settings
from app.core.security import password_problems

# Seed and test accounts use the reserved ".test" TLD; allow it everywhere except prod.
if get_settings().environment != "prod" and "test" in email_validator.SPECIAL_USE_DOMAIN_NAMES:
    email_validator.SPECIAL_USE_DOMAIN_NAMES.remove("test")


def no_nul(value: str) -> str:
    """Found by the contract test: Postgres text can't hold a NUL (0x00) byte, so one in any
    input reached the database as a DataError - a 500. It's bad input: reject it as a 422."""
    if "\x00" in value:
        raise ValueError("Must not contain NUL characters.")
    return value


SafeStr = Annotated[str, AfterValidator(no_nul)]  # for str path and query parameters


class InputModel(BaseModel):
    """Base for anything parsed from a request: no NUL bytes in any string field."""

    @field_validator("*", mode="after")
    @classmethod
    def _reject_nul(cls, value: object) -> object:
        return no_nul(value) if isinstance(value, str) else value


class StrictModel(InputModel):
    """Request bodies reject unknown fields - e.g. a sneaky ``"role": "admin"`` is a 422."""

    model_config = ConfigDict(extra="forbid")


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _check_password(value: str) -> str:
    problems = password_problems(value)
    if problems:
        raise ValueError("Password needs " + ", ".join(problems) + ".")
    return value


Email = Annotated[EmailStr, AfterValidator(_normalize_email)]
NewPassword = Annotated[str, AfterValidator(_check_password)]
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
