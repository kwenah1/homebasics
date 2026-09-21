"""JWT access tokens (ACC-03). Expiry is checked against the controllable clock."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

import jwt

from app.config import get_settings
from app.core import clock
from app.core.errors import AppError

ALGORITHM = "HS256"


@dataclass(frozen=True)
class AccessClaims:
    user_id: int
    role: str
    expires_at: datetime


def create_access_token(user_id: int, role: str) -> tuple[str, int]:
    """Returns (token, lifetime_seconds)."""
    settings = get_settings()
    issued = clock.now()
    lifetime = timedelta(minutes=settings.access_token_minutes)
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": int(issued.timestamp()),
        "exp": int((issued + lifetime).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)
    return token, int(lifetime.total_seconds())


def _unauthorized(code: str, message: str) -> AppError:
    return AppError(401, code, message, headers={"WWW-Authenticate": "Bearer"})


def decode_access_token(token: str) -> AccessClaims:
    try:
        # pyjwt checks exp against the real clock; we check it against clock.now() below.
        payload = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=[ALGORITHM],
            options={"verify_exp": False, "require": ["sub", "exp", "type"]},
        )
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("invalid_token", "Invalid access token.") from exc

    if payload.get("type") != "access":
        raise _unauthorized("invalid_token", "Invalid access token.")
    if payload["exp"] <= clock.now().timestamp():
        raise _unauthorized("token_expired", "Access token expired.")
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise _unauthorized("invalid_token", "Invalid access token.") from exc

    return AccessClaims(
        user_id=user_id,
        role=str(payload.get("role", "")),
        expires_at=datetime.fromtimestamp(payload["exp"], tz=clock.now().tzinfo),
    )
