from fastapi import APIRouter, Cookie, Depends, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import AppError, error_body
from app.core.rate_limit import limit
from app.core.tokens import create_access_token
from app.db import get_db
from app.models import User
from app.schemas.auth import (
    ForgotPasswordIn,
    LoginIn,
    MessageOut,
    RegisterIn,
    ResetPasswordIn,
    TokenOut,
)
from app.schemas.user import UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_PATH = "/api/v1/auth"
RATE_LIMITED = {429: {"description": "Too many attempts from this client (see Retry-After)"}}
settings = get_settings()


def _set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=raw,
        max_age=settings.refresh_token_days * 24 * 3600,
        path=REFRESH_COOKIE_PATH,  # only ever sent to auth endpoints
        httponly=True,  # unreadable from JavaScript (XSS can't steal it)
        secure=settings.environment == "prod",
        samesite="strict",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.environment == "prod",
        samesite="strict",
    )


def start_session(db: Session, response: Response, user: User) -> TokenOut:
    raw, _ = auth_service.issue_refresh_token(db, user.id)
    db.commit()
    _set_refresh_cookie(response, raw)
    token, expires_in = create_access_token(user.id, user.role.value)
    return TokenOut(access_token=token, expires_in=expires_in, user=UserOut.model_validate(user))


RefreshCookie = Cookie(default=None, alias=settings.refresh_cookie_name, include_in_schema=False)


@router.post(
    "/register",
    response_model=TokenOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit("register"))],
    responses={409: {"description": "Email already registered"}, **RATE_LIMITED},
)
def register(data: RegisterIn, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    """ACC-01/02: create an account and sign straight in."""
    user = auth_service.register(db, data)
    return start_session(db, response, user)


@router.post(
    "/login",
    response_model=TokenOut,
    dependencies=[Depends(limit("login"))],
    responses={
        401: {"description": "Email or password is incorrect"},
        423: {"description": "Account locked after repeated failures (ACC-04)"},
        **RATE_LIMITED,
    },
)
def login(data: LoginIn, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    """ACC-03/04. 401 invalid_credentials, 423 account_locked (with Retry-After)."""
    user = auth_service.authenticate(db, data.email, data.password)
    return start_session(db, response, user)


@router.post(
    "/refresh",
    response_model=TokenOut,
    dependencies=[Depends(limit("refresh"))],
    responses={401: {"description": "Session invalid"}, **RATE_LIMITED},
)
def refresh(
    response: Response, db: Session = Depends(get_db), raw: str | None = RefreshCookie
) -> TokenOut | JSONResponse:
    """Rotate the refresh cookie and return a fresh access token."""
    try:
        user, new_raw = auth_service.rotate_refresh_token(db, raw)
    except AppError as exc:
        # Build the error response here so the dead cookie is cleared along with it.
        failed = JSONResponse(error_body(exc.code, exc.message), status_code=exc.status_code)
        _clear_refresh_cookie(failed)
        return failed
    _set_refresh_cookie(response, new_raw)
    token, expires_in = create_access_token(user.id, user.role.value)
    return TokenOut(access_token=token, expires_in=expires_in, user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(db: Session = Depends(get_db), raw: str | None = RefreshCookie) -> Response:
    auth_service.revoke_refresh_token(db, raw)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response)
    return response


@router.post(
    "/forgot-password",
    response_model=MessageOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(limit("forgot_password"))],
    responses=RATE_LIMITED,
)
def forgot_password(data: ForgotPasswordIn, db: Session = Depends(get_db)) -> MessageOut:
    """ACC-06. Same response whether or not the account exists."""
    auth_service.request_password_reset(db, data.email)
    return MessageOut(message="If that email is registered, a reset link is on its way.")


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(limit("reset_password"))],
    responses={400: {"description": "Reset link invalid, used or expired"}, **RATE_LIMITED},
)
def reset_password(data: ResetPasswordIn, db: Session = Depends(get_db)) -> Response:
    auth_service.reset_password(db, data.token, data.new_password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
