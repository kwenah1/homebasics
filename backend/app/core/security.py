import hashlib
import re
import secrets
from functools import lru_cache

import bcrypt

from app.config import get_settings

PASSWORD_MIN = 8
PASSWORD_MAX = 64
_BCRYPT_MAX_BYTES = 72  # bcrypt silently ignores (v5: rejects) anything longer


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=get_settings().bcrypt_rounds)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


@lru_cache
def _dummy_hash() -> str:
    # Hash of a random password at the same cost as real ones: checking against it when the
    # email is unknown makes response timing identical, so it can't reveal registered emails.
    return hash_password(secrets.token_urlsafe(16))


def verify_password(password: str, password_hash: str) -> bool:
    encoded = password.encode("utf-8")
    if len(encoded) > _BCRYPT_MAX_BYTES:
        return False
    return bcrypt.checkpw(encoded, password_hash.encode("utf-8"))


def burn_password_check(password: str) -> None:
    verify_password(password, _dummy_hash())


def password_problems(password: str) -> list[str]:
    """ACC-02 policy. Returns human-readable problems; empty list means acceptable."""
    problems = []
    if len(password) < PASSWORD_MIN:
        problems.append(f"at least {PASSWORD_MIN} characters")
    if len(password) > PASSWORD_MAX or len(password.encode("utf-8")) > _BCRYPT_MAX_BYTES:
        problems.append(f"at most {PASSWORD_MAX} characters")
    if not re.search(r"[A-Za-z]", password):
        problems.append("at least one letter")
    if not re.search(r"\d", password):
        problems.append("at least one number")
    return problems


def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Refresh/reset tokens are stored hashed: a DB leak doesn't leak live sessions."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
