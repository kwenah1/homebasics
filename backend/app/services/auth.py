"""Accounts and sessions: ACC-01..04, ACC-06."""

import math
import uuid
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import bugs, clock
from app.core.errors import AppError
from app.core.security import (
    burn_password_check,
    hash_password,
    hash_token,
    new_opaque_token,
    verify_password,
)
from app.models import PasswordResetToken, RefreshToken, User
from app.schemas.auth import RegisterIn
from app.services.email import queue_email


def _invalid_credentials() -> AppError:
    # Identical for unknown email and wrong password: no account enumeration.
    return AppError(401, "invalid_credentials", "Email or password is incorrect.")


def find_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


# --- Registration ------------------------------------------------------------------------


def register(db: Session, data: RegisterIn) -> User:
    if find_user_by_email(db, data.email):
        raise AppError(
            409,
            "email_taken",
            "An account with this email already exists.",
            fields={"email": "This email is already registered."},
        )
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        first_name=data.first_name,
        last_name=data.last_name,
    )
    db.add(user)
    db.commit()
    return user


# --- Login & lockout (ACC-04) --------------------------------------------------------------


def _locked_error(user: User) -> AppError:
    seconds = max(1, math.ceil((user.locked_until - clock.now()).total_seconds()))
    return AppError(
        423,
        "account_locked",
        "Too many failed attempts. Try again later or reset your password.",
        headers={"Retry-After": str(seconds)},
        extra={"retry_after_seconds": seconds},
    )


def authenticate(db: Session, email: str, password: str) -> User:
    settings = get_settings()
    user = find_user_by_email(db, email)
    if user is None:
        burn_password_check(password)  # same cost as a real check: no timing oracle
        raise _invalid_credentials()

    now = clock.now()
    if user.locked_until is not None:
        if user.locked_until > now:
            raise _locked_error(user)
        # Lock has expired: start counting from zero again.
        user.locked_until = None
        user.failed_login_count = 0

    if not verify_password(password, user.password_hash):
        user.failed_login_count += 1
        if user.failed_login_count >= settings.lockout_threshold + bugs.active("lockout_after_six"):
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            db.commit()
            raise _locked_error(user)
        db.commit()
        raise _invalid_credentials()

    user.failed_login_count = 0
    db.commit()
    return user


# --- Refresh tokens (ACC-03) ---------------------------------------------------------------


def issue_refresh_token(db: Session, user_id: int, family_id: str | None = None):
    raw = new_opaque_token()
    row = RefreshToken(
        user_id=user_id,
        token_hash=hash_token(raw),
        family_id=family_id or uuid.uuid4().hex,
        expires_at=clock.now() + timedelta(days=get_settings().refresh_token_days),
    )
    db.add(row)
    db.flush()
    return raw, row


def _find_refresh(db: Session, raw: str | None) -> RefreshToken | None:
    if not raw:
        return None
    return db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))


def rotate_refresh_token(db: Session, raw: str | None) -> tuple[User, str]:
    """Exchange a refresh token for a new one. Reuse of a rotated token revokes the family."""
    row = _find_refresh(db, raw)
    if row is None:
        raise AppError(401, "invalid_refresh_token", "Please sign in again.")

    now = clock.now()
    if row.revoked_at is not None:
        grace = timedelta(seconds=get_settings().refresh_reuse_grace_seconds)
        rotated_moments_ago = row.replaced_by_id is not None and now - row.revoked_at <= grace
        # The family must still be alive: a password change/reset or a detected theft revokes
        # every token in it, and the grace must never undo that.
        family_alive = db.scalar(
            select(RefreshToken.id)
            .where(
                RefreshToken.family_id == row.family_id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now,
            )
            .limit(1)
        )
        if rotated_moments_ago and family_alive is not None and row.expires_at > now:
            # Regression (found by E2E): the browser navigated away while a refresh was in
            # flight - the server rotated the token but the new cookie never arrived, so the
            # next page presented the old one and was signed out as a "thief". Within the grace
            # window, issue another token in the same family instead.
            user = db.get(User, row.user_id)
            new_raw, _ = issue_refresh_token(db, row.user_id, row.family_id)
            db.commit()
            return user, new_raw
        revoke_family(db, row.family_id)
        db.commit()
        raise AppError(401, "refresh_token_reused", "Session ended for your security.")
    if row.expires_at <= now:
        raise AppError(401, "refresh_token_expired", "Your session has expired.")

    user = db.get(User, row.user_id)
    new_raw, new_row = issue_refresh_token(db, row.user_id, row.family_id)
    row.revoked_at = now
    row.replaced_by_id = new_row.id
    db.commit()
    return user, new_raw


def revoke_refresh_token(db: Session, raw: str | None) -> None:
    row = _find_refresh(db, raw)
    if row is not None and row.revoked_at is None:
        row.revoked_at = clock.now()
        db.commit()


def revoke_family(db: Session, family_id: str) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=clock.now())
    )


def revoke_all_sessions(db: Session, user_id: int) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=clock.now())
    )


# --- Password change & reset (ACC-05, ACC-06) ----------------------------------------------


def change_password(db: Session, user: User, current: str, new: str) -> None:
    if not verify_password(current, user.password_hash):
        raise AppError(
            400,
            "wrong_password",
            "Current password is incorrect.",
            fields={"current_password": "Current password is incorrect."},
        )
    if verify_password(new, user.password_hash):
        raise AppError(
            400,
            "password_unchanged",
            "New password must be different from the current one.",
            fields={"new_password": "Choose a password you haven't used here."},
        )
    user.password_hash = hash_password(new)
    revoke_all_sessions(db, user.id)  # every device must sign in again with the new password
    db.commit()


def request_password_reset(db: Session, email: str) -> None:
    """Always 'succeeds' from the caller's view so it can't be used to probe for accounts."""
    user = find_user_by_email(db, email)
    if user is None:
        return
    settings = get_settings()
    raw = new_opaque_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            expires_at=clock.now() + timedelta(minutes=settings.reset_token_minutes),
        )
    )
    link = f"{settings.web_base_url}/reset-password?token={raw}"
    queue_email(
        db,
        to=user.email,
        subject="Reset your HomeBasics password",
        body=(
            f"Hi {user.first_name},\n\n"
            f"Use this link to choose a new password. It expires in "
            f"{settings.reset_token_minutes} minutes and works once:\n\n{link}\n\n"
            "If you didn't ask for this, you can ignore this email."
        ),
    )
    db.commit()


def reset_password(db: Session, raw: str, new_password: str) -> None:
    now = clock.now()
    row = db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw))
    )
    if row is None or row.used_at is not None or row.expires_at <= now:
        raise AppError(400, "invalid_reset_token", "This reset link is invalid or has expired.")

    user = db.get(User, row.user_id)
    user.password_hash = hash_password(new_password)
    user.failed_login_count = 0
    user.locked_until = None
    # Burn this and any other outstanding links for the user.
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    revoke_all_sessions(db, user.id)
    db.commit()
