import pytest
from pydantic import ValidationError

from app.config import Settings

STRONG_SECRET = "x" * 40


def make(**overrides) -> Settings:
    # _env_file=None ignores the developer's .env; conftest sets ENABLE_TEST_ENDPOINTS in the
    # process env, so default it off here to keep each case isolated.
    overrides.setdefault("enable_test_endpoints", False)
    overrides.setdefault("bcrypt_rounds", 12)  # conftest sets BCRYPT_ROUNDS=4 for speed
    return Settings(_env_file=None, **overrides)


class TestDatabaseUrl:
    @pytest.mark.parametrize(
        "raw",
        ["postgresql://u:p@host/db?sslmode=require", "postgres://u:p@host/db?sslmode=require"],
    )
    def test_plain_postgres_urls_use_psycopg_driver(self, raw):
        assert make(database_url=raw).database_url == (
            "postgresql+psycopg://u:p@host/db?sslmode=require"
        )

    def test_explicit_driver_is_left_alone(self):
        url = "postgresql+psycopg://u:p@host/db"
        assert make(database_url=url).database_url == url


class TestCorsOrigins:
    def test_comma_separated_string_is_split_and_trimmed(self):
        settings = make(cors_origins="http://a.test, http://b.test ,")
        assert settings.cors_origins == ["http://a.test", "http://b.test"]

    def test_env_var_string_is_accepted(self, monkeypatch):
        monkeypatch.setenv("CORS_ORIGINS", "http://a.test,http://b.test")
        assert make().cors_origins == ["http://a.test", "http://b.test"]


class TestProdGuards:
    def test_test_endpoints_forbidden_in_prod(self):
        with pytest.raises(ValidationError, match="ENABLE_TEST_ENDPOINTS"):
            make(environment="prod", jwt_secret=STRONG_SECRET, enable_test_endpoints=True)

    @pytest.mark.parametrize("secret", ["dev-only-insecure-secret-change-me", "short"])
    def test_weak_jwt_secret_rejected_in_prod(self, secret):
        with pytest.raises(ValidationError, match="JWT_SECRET"):
            make(environment="prod", jwt_secret=secret)

    def test_low_bcrypt_cost_rejected_in_prod(self):
        with pytest.raises(ValidationError, match="BCRYPT_ROUNDS"):
            make(environment="prod", jwt_secret=STRONG_SECRET, bcrypt_rounds=4)

    def test_valid_prod_config(self):
        settings = make(environment="prod", jwt_secret=STRONG_SECRET)
        assert settings.test_endpoints_active is False

    @pytest.mark.parametrize(
        ("environment", "flag", "expected"),
        [("dev", True, True), ("test", True, True), ("dev", False, False)],
    )
    def test_test_endpoints_active(self, environment, flag, expected):
        settings = make(environment=environment, enable_test_endpoints=flag)
        assert settings.test_endpoints_active is expected
