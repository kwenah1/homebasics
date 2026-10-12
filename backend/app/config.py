from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["dev", "test", "prod"]


class Settings(BaseSettings):
    # Resolve backend/.env regardless of the working directory the server starts in.
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "HomeBasics API"
    version: str = "0.1.0"
    environment: Environment = "dev"

    database_url: str = "postgresql+psycopg://homebasics:homebasics@localhost:5432/homebasics"
    test_database_url: str | None = None

    jwt_secret: str = "dev-only-insecure-secret-change-me"  # noqa: S105
    bcrypt_rounds: int = 12  # tests use 4 for speed; never lower this in prod
    access_token_minutes: int = 15  # ACC-03
    refresh_token_days: int = 7  # ACC-03
    refresh_cookie_name: str = "hb_refresh"
    # ACC-03b: a just-rotated refresh token presented again within this window is treated as a
    # benign race (navigation aborted the response, two tabs refreshing) - not as theft.
    refresh_reuse_grace_seconds: int = 30
    lockout_threshold: int = 5  # ACC-04
    lockout_minutes: int = 15  # ACC-04
    reset_token_minutes: int = 30  # ACC-06
    max_addresses: int = 5  # ACC-05

    # Used to build links in emails (password reset).
    web_base_url: str = "http://localhost:5173"

    # NoDecode: accept a plain comma-separated env value instead of requiring JSON.
    # NFR-SEC auth rate limits. None = automatic: on in prod, off in dev/test.
    rate_limit_enabled: bool | None = None
    # Known, deliberate defects for proving the tests work (see app/core/bugs.py). Never in prod.
    bug_injection: Annotated[list[str], NoDecode] = []

    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    enable_test_endpoints: bool = False

    # --- Deployment (M9) ----------------------------------------------------------------------
    # Shared rate-limit store. Without it the limiter is per-process, which only holds for a
    # single instance (NFR-SEC-01).
    redis_url: str | None = None
    # Outbox delivery. Without a host, emails stay in the table (dev and test behaviour).
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = True
    email_from: str = "HomeBasics <no-reply@homebasics.test>"
    # In-process background worker: expiry sweep + outbox delivery (OPS-01).
    worker_enabled: bool = False
    worker_interval_seconds: int = 60
    outbox_batch_size: int = 20
    sentry_dsn: str | None = None

    @field_validator("database_url", "test_database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str | None) -> str | None:
        # Neon/Heroku-style URLs are plain postgresql:// - point SQLAlchemy at psycopg 3.
        for prefix in ("postgresql://", "postgres://"):
            if value and value.startswith(prefix):
                return "postgresql+psycopg://" + value.removeprefix(prefix)
        return value

    @field_validator("bug_injection", mode="before")
    @classmethod
    def split_bugs(cls, value: object) -> object:
        from app.core.bug_catalog import KNOWN_BUGS

        if isinstance(value, str):
            value = [b.strip() for b in value.split(",") if b.strip()]
        unknown = set(value or []) - set(KNOWN_BUGS)  # type: ignore[arg-type]
        if unknown:
            raise ValueError(f"unknown BUG_INJECTION names: {sorted(unknown)}")
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def guard_prod(self) -> "Settings":
        if self.environment == "prod":
            if self.enable_test_endpoints:
                raise ValueError("ENABLE_TEST_ENDPOINTS must be false in prod")
            if self.jwt_secret.startswith("dev-only") or len(self.jwt_secret) < 32:
                raise ValueError("JWT_SECRET must be set to 32+ random characters in prod")
            if self.bcrypt_rounds < 12:
                raise ValueError("BCRYPT_ROUNDS must be at least 12 in prod")
            if self.bug_injection:
                raise ValueError("BUG_INJECTION must be empty in prod")
            if self.rate_limit_enabled is False:
                raise ValueError("RATE_LIMIT_ENABLED can't be turned off in prod")
            # A deploy that silently points emails and reset links at localhost is worse than
            # one that refuses to start.
            if not self.web_base_url.startswith("https://"):
                raise ValueError("WEB_BASE_URL must be an https URL in prod")
            if any("localhost" in origin or "127.0.0.1" in origin for origin in self.cors_origins):
                raise ValueError("CORS_ORIGINS must not include localhost in prod")
        return self

    @property
    def rate_limit_active(self) -> bool:
        if self.rate_limit_enabled is None:
            return self.environment == "prod"
        return self.rate_limit_enabled

    @property
    def email_sending_enabled(self) -> bool:
        return bool(self.smtp_host)

    @property
    def test_endpoints_active(self) -> bool:
        return self.enable_test_endpoints and self.environment != "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()
