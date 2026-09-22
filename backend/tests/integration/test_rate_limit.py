"""NFR-SEC: per-client rate limits on the auth endpoints."""

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import create_app
from tests.helpers import error_code, travel


@pytest.fixture
def limited(db, test_settings):
    """A client for an app with rate limiting switched on (it's off by default in tests)."""
    app = create_app(test_settings.model_copy(update={"rate_limit_enabled": True}))
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c


def bad_login(client):
    return client.post(
        "/api/v1/auth/login", json={"email": "nobody@e2e.test", "password": "Wrong1234"}
    )


def test_eleventh_login_in_a_minute_is_429(frozen_clock, limited):
    assert [bad_login(limited).status_code for _ in range(10)] == [401] * 10
    blocked = bad_login(limited)
    assert blocked.status_code == 429
    assert error_code(blocked) == "rate_limited"
    assert blocked.headers["Retry-After"] == "60"
    assert blocked.json()["error"]["retry_after_seconds"] == 60


def test_window_slides(frozen_clock, limited):
    for _ in range(10):
        bad_login(limited)
    travel(seconds=59)
    assert bad_login(limited).status_code == 429
    travel(seconds=1)  # the first attempt has left the 60 s window
    assert bad_login(limited).status_code == 401


def test_blocked_requests_do_not_count(frozen_clock, limited):
    for _ in range(10):
        bad_login(limited)
    for _ in range(5):
        assert bad_login(limited).status_code == 429
    travel(seconds=60)
    assert [bad_login(limited).status_code for _ in range(10)] == [401] * 10


def test_rules_are_independent(frozen_clock, limited):
    for _ in range(10):
        bad_login(limited)
    assert bad_login(limited).status_code == 429
    ok = limited.post("/api/v1/auth/forgot-password", json={"email": "a@e2e.test"})
    assert ok.status_code == 202


@pytest.mark.parametrize(
    ("path", "body", "allowed"),
    [
        ("/api/v1/auth/forgot-password", {"email": "a@e2e.test"}, 5),
        ("/api/v1/auth/register", {}, 5),  # even invalid attempts count
        ("/api/v1/auth/reset-password", {"token": "x" * 20, "new_password": "Brandnew99"}, 10),
    ],
)
def test_other_limits(frozen_clock, limited, path, body, allowed):
    statuses = [limited.post(path, json=body).status_code for _ in range(allowed + 1)]
    assert 429 not in statuses[:allowed]
    assert statuses[-1] == 429


def test_off_by_default_outside_prod(client):
    """The E2E suite signs in hundreds of times from one address."""
    assert all(bad_login(client).status_code == 401 for _ in range(15))


def test_prod_cannot_turn_it_off():
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError, match="RATE_LIMIT_ENABLED"):
        Settings(
            _env_file=None,
            environment="prod",
            jwt_secret="x" * 40,
            enable_test_endpoints=False,
            bcrypt_rounds=12,
            rate_limit_enabled=False,
        )
    assert Settings(
        _env_file=None,
        environment="prod",
        jwt_secret="x" * 40,
        enable_test_endpoints=False,
        bcrypt_rounds=12,
    ).rate_limit_active
