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
    access_token_minutes: int = 15
    refresh_token_days: int = 7

    # NoDecode: accept a plain comma-separated env value instead of requiring JSON.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    enable_test_endpoints: bool = False

    @field_validator("database_url", "test_database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str | None) -> str | None:
        # Neon/Heroku-style URLs are plain postgresql:// - point SQLAlchemy at psycopg 3.
        for prefix in ("postgresql://", "postgres://"):
            if value and value.startswith(prefix):
                return "postgresql+psycopg://" + value.removeprefix(prefix)
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
        return self

    @property
    def test_endpoints_active(self) -> bool:
        return self.enable_test_endpoints and self.environment != "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()
