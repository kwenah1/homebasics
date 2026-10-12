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


def make_prod(**overrides) -> Settings:
    """A deployable prod config: anything missing here is a guard worth having (M9)."""
    defaults = {
        "environment": "prod",
        "jwt_secret": STRONG_SECRET,
        "web_base_url": "https://shop.example.com",
        "cors_origins": ["https://shop.example.com"],
    }
    return make(**{**defaults, **overrides})


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
            make_prod(enable_test_endpoints=True)

    @pytest.mark.parametrize("secret", ["dev-only-insecure-secret-change-me", "short"])
    def test_weak_jwt_secret_rejected_in_prod(self, secret):
        with pytest.raises(ValidationError, match="JWT_SECRET"):
            make_prod(jwt_secret=secret)

    def test_low_bcrypt_cost_rejected_in_prod(self):
        with pytest.raises(ValidationError, match="BCRYPT_ROUNDS"):
            make_prod(bcrypt_rounds=4)

    # M9: a deploy that still points at localhost would send reset links nobody can open.
    @pytest.mark.parametrize("url", ["http://shop.example.com", "http://localhost:5173"])
    def test_non_https_web_base_url_rejected_in_prod(self, url):
        with pytest.raises(ValidationError, match="WEB_BASE_URL"):
            make_prod(web_base_url=url)

    @pytest.mark.parametrize(
        "origins",
        [["http://localhost:5173"], ["https://shop.example.com", "http://127.0.0.1:3000"]],
    )
    def test_localhost_cors_rejected_in_prod(self, origins):
        with pytest.raises(ValidationError, match="CORS_ORIGINS"):
            make_prod(cors_origins=origins)

    def test_valid_prod_config(self):
        settings = make_prod()
        assert settings.test_endpoints_active is False
        assert settings.rate_limit_active is True
        assert settings.email_sending_enabled is False  # until SMTP_HOST is set

    def test_dev_defaults_are_not_held_to_prod_rules(self):
        """Localhost and http are exactly right outside prod."""
        settings = make()
        assert settings.web_base_url.startswith("http://localhost")
        assert settings.cors_origins == ["http://localhost:5173"]


class TestDeploymentSettings:
    def test_redis_and_smtp_are_off_by_default(self):
        settings = make()
        assert (settings.redis_url, settings.smtp_host) == (None, None)
        assert settings.email_sending_enabled is False
        assert (settings.worker_enabled, settings.sentry_dsn) == (False, None)

    def test_smtp_host_switches_sending_on(self):
        assert make(smtp_host="smtp.example.com").email_sending_enabled is True

    @pytest.mark.parametrize(
        ("environment", "flag", "expected"),
        [("dev", True, True), ("test", True, True), ("dev", False, False)],
    )
    def test_test_endpoints_active(self, environment, flag, expected):
        settings = make(environment=environment, enable_test_endpoints=flag)
        assert settings.test_endpoints_active is expected
