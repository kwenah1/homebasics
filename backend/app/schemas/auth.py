from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import Email, NewPassword, PersonName, StrictModel
from app.schemas.user import UserOut


class RegisterIn(StrictModel):
    email: Email
    password: NewPassword
    first_name: PersonName
    last_name: PersonName


class LoginIn(StrictModel):
    email: Email
    # No policy check on login: old/seeded passwords must still be accepted.
    password: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - OAuth2 token type, not a secret
    expires_in: int
    user: UserOut


class ForgotPasswordIn(StrictModel):
    email: Email


class ResetPasswordIn(StrictModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: NewPassword


class MessageOut(BaseModel):
    message: str
