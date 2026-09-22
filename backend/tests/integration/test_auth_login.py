"""ACC-03 login and ACC-04 lockout (5 failures -> locked 15 minutes)."""

import pytest

from tests.helpers import error_code, travel

URL = "/api/v1/auth/login"


def login(client, email, password):
    return client.post(URL, json={"email": email, "password": password})


def test_seed_customer_can_log_in(client):
    response = login(client, "customer@homebasics.test", "Customer123")
    assert response.status_code == 200
    assert response.json()["user"]["first_name"] == "Casey"


def test_login_email_is_case_insensitive(client):
    assert login(client, "CUSTOMER@HomeBasics.test", "Customer123").status_code == 200


def test_refresh_cookie_flags(client):
    response = login(client, "customer@homebasics.test", "Customer123")
    cookie = response.headers["set-cookie"].lower()
    assert "hb_refresh=" in cookie
    assert "httponly" in cookie
    assert "samesite=strict" in cookie
    assert "path=/api/v1/auth" in cookie
    assert "max-age=604800" in cookie  # 7 days


def test_password_is_case_sensitive(client):
    response = login(client, "customer@homebasics.test", "customer123")
    assert response.status_code == 401


def test_wrong_password_and_unknown_email_look_identical(client):
    """No account enumeration: same status, code and message."""
    wrong_pw = login(client, "customer@homebasics.test", "Nope12345")
    no_user = login(client, "nobody@homebasics.test", "Nope12345")
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()
    assert error_code(wrong_pw) == "invalid_credentials"


class TestLockout:
    def fail(self, client, email, times):
        return [login(client, email, "WrongPass1") for _ in range(times)]

    def test_four_failures_still_allow_login(self, client, make_user):
        user, pw = make_user()
        assert [r.status_code for r in self.fail(client, user.email, 4)] == [401] * 4
        assert login(client, user.email, pw).status_code == 200

    def test_fifth_failure_locks_account(self, client, make_user):
        user, _ = make_user()
        responses = self.fail(client, user.email, 5)

        assert [r.status_code for r in responses] == [401, 401, 401, 401, 423]
        locked = responses[-1]
        assert error_code(locked) == "account_locked"
        assert locked.headers["Retry-After"] == "900"
        assert locked.json()["error"]["retry_after_seconds"] == 900

    def test_correct_password_rejected_while_locked(self, frozen_clock, client, make_user):
        user, pw = make_user()
        self.fail(client, user.email, 5)
        travel(minutes=14, seconds=59)

        response = login(client, user.email, pw)
        assert response.status_code == 423
        assert response.json()["error"]["retry_after_seconds"] == 1

    def test_unlocks_after_fifteen_minutes(self, frozen_clock, client, make_user):
        user, pw = make_user()
        self.fail(client, user.email, 5)
        travel(minutes=15)
        assert login(client, user.email, pw).status_code == 200

    def test_counter_restarts_after_lock_expires(self, client, make_user):
        user, _ = make_user()
        self.fail(client, user.email, 5)
        travel(minutes=15)
        # A single new failure must not immediately re-lock.
        assert login(client, user.email, "WrongPass1").status_code == 401

    def test_successful_login_resets_counter(self, client, make_user):
        user, pw = make_user()
        self.fail(client, user.email, 4)
        assert login(client, user.email, pw).status_code == 200
        # Counter back at zero: four more failures are still only 401s.
        assert [r.status_code for r in self.fail(client, user.email, 4)] == [401] * 4

    def test_lockout_is_per_account(self, client, make_user):
        victim, _ = make_user()
        bystander, pw = make_user()
        self.fail(client, victim.email, 5)
        assert login(client, bystander.email, pw).status_code == 200


@pytest.mark.parametrize(
    "body",
    [{}, {"email": "customer@homebasics.test"}, {"password": "x"}, {"email": "x", "password": ""}],
)
def test_malformed_login_is_422(client, body):
    assert client.post(URL, json=body).status_code == 422
