"""Request-level auth dependencies. ADM-04 role guard lives here too."""

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.tokens import decode_access_token
from app.db import get_db
from app.models import User, UserRole

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(
            401,
            "not_authenticated",
            "Sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    claims = decode_access_token(credentials.credentials)
    user = db.get(User, claims.user_id)
    if user is None:
        raise AppError(401, "invalid_token", "Invalid access token.")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    # Role comes from the database, not the token, so a demotion takes effect immediately.
    if user.role != UserRole.ADMIN:
        raise AppError(403, "forbidden", "You don't have permission to do that.")
    return user
