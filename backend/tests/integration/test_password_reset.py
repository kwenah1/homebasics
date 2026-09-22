"""ACC-06: forgot/reset password via emailed single-use 30-minute link."""

import re

from sqlalchemy import select

from app.models import OutboxEmail
from tests.helpers import error_code, travel

FORGOT = "/api/v1/auth/forgot-password"
RESET = "/api/v1/auth/reset-password"
LOGIN = "/api/v1/auth/login"


def emails_to(db, address):
    return db.scalars(
        select(OutboxEmail).where(OutboxEmail.to_address == address).order_by(OutboxEmail.id)
    ).all()


def request_token(client, db, email) -> str:
    assert client.post(FORGOT, json={"email": email}).status_code == 202
    body = emails_to(db, email)[-1].body
    return re.search(r"reset-password\?token=([\w-]+)", body).group(1)


def login(client, email, password):
    return client.post(LOGIN, json={"email": email, "password": password})


def test_forgot_password_sends_link(client, db, make_user):
    user, _ = make_user()
    response = client.post(FORGOT, json={"email": user.email.upper()})

    assert response.status_code == 202
    [email] = emails_to(db, user.email)
    assert email.subject == "Reset your HomeBasics password"
    assert "http://localhost:5173/reset-password?token=" in email.body
    assert "30 minutes" in email.body


def test_unknown_email_gets_same_response_and_no_email(client, db, make_user):
    user, _ = make_user()
    known = client.post(FORGOT, json={"email": user.email})
    unknown = client.post(FORGOT, json={"email": "ghost@homebasics.test"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert emails_to(db, "ghost@homebasics.test") == []


def test_reset_changes_password(client, db, make_user):
    user, old = make_user()
    token = request_token(client, db, user.email)

    assert (
        client.post(RESET, json={"token": token, "new_password": "Brandnew99"}).status_code == 204
    )
    assert login(client, user.email, old).status_code == 401
    assert login(client, user.email, "Brandnew99").status_code == 200


def test_token_is_single_use(client, db, make_user):
    user, _ = make_user()
    token = request_token(client, db, user.email)
    client.post(RESET, json={"token": token, "new_password": "Brandnew99"})

    again = client.post(RESET, json={"token": token, "new_password": "Another99"})
    assert again.status_code == 400
    assert error_code(again) == "invalid_reset_token"


def test_token_valid_until_thirty_minutes(frozen_clock, client, db, make_user):
    user, _ = make_user()
    token = request_token(client, db, user.email)
    travel(minutes=29, seconds=59)
    assert (
        client.post(RESET, json={"token": token, "new_password": "Brandnew99"}).status_code == 204
    )


def test_token_expires_at_thirty_minutes(frozen_clock, client, db, make_user):
    user, _ = make_user()
    token = request_token(client, db, user.email)
    travel(minutes=30)
    response = client.post(RESET, json={"token": token, "new_password": "Brandnew99"})
    assert error_code(response) == "invalid_reset_token"


def test_using_one_link_invalidates_older_links(client, db, make_user):
    user, _ = make_user()
    first = request_token(client, db, user.email)
    second = request_token(client, db, user.email)
    client.post(RESET, json={"token": second, "new_password": "Brandnew99"})
    response = client.post(RESET, json={"token": first, "new_password": "Another99"})
    assert error_code(response) == "invalid_reset_token"


def test_garbage_token_rejected(client):
    response = client.post(RESET, json={"token": "x" * 43, "new_password": "Brandnew99"})
    assert error_code(response) == "invalid_reset_token"


def test_new_password_must_meet_policy(client, db, make_user):
    user, _ = make_user()
    token = request_token(client, db, user.email)
    response = client.post(RESET, json={"token": token, "new_password": "weak"})
    assert response.status_code == 422
    assert "new_password" in response.json()["error"]["fields"]


def test_reset_signs_out_existing_sessions(client, db, make_user):
    user, pw = make_user()
    login(client, user.email, pw)
    token = request_token(client, db, user.email)

    client.post(RESET, json={"token": token, "new_password": "Brandnew99"})
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_reset_unlocks_a_locked_account(client, db, make_user):
    user, _ = make_user()
    for _ in range(5):
        login(client, user.email, "WrongPass1")
    assert login(client, user.email, "WrongPass1").status_code == 423

    token = request_token(client, db, user.email)
    client.post(RESET, json={"token": token, "new_password": "Brandnew99"})
    assert login(client, user.email, "Brandnew99").status_code == 200
