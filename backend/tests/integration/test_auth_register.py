"""ACC-01 / ACC-02: registration."""

import pytest
from sqlalchemy import select

from app.models import User
from tests.helpers import error_code

URL = "/api/v1/auth/register"
VALID = {
    "email": "new.person@homebasics.test",
    "password": "Sparkle123",
    "first_name": "New",
    "last_name": "Person",
}


def test_register_creates_customer_and_signs_in(client, db):
    response = client.post(URL, json=VALID)

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 900
    assert body["user"]["email"] == "new.person@homebasics.test"
    assert body["user"]["role"] == "customer"
    assert "password" not in response.text and "password_hash" not in response.text
    assert "hb_refresh" in response.cookies

    user = db.scalar(select(User).where(User.email == VALID["email"]))
    assert user.password_hash.startswith("$2") and user.password_hash != VALID["password"]


def test_email_is_normalized_to_lowercase(client):
    response = client.post(URL, json={**VALID, "email": "  Mixed.Case@HomeBasics.TEST "})
    assert response.json()["user"]["email"] == "mixed.case@homebasics.test"


@pytest.mark.parametrize(
    "email", ["customer@homebasics.test", "CUSTOMER@homebasics.test", "Customer@HomeBasics.Test"]
)
def test_duplicate_email_rejected_case_insensitively(client, email):
    response = client.post(URL, json={**VALID, "email": email})
    assert response.status_code == 409
    assert error_code(response) == "email_taken"
    assert response.json()["error"]["fields"] == {"email": "This email is already registered."}


@pytest.mark.parametrize(
    ("password", "fragment"),
    [
        ("short1", "at least 8 characters"),
        ("longenoughbutnodigits", "at least one number"),
        ("123456789", "at least one letter"),
    ],
)
def test_weak_password_rejected_with_field_error(client, password, fragment):
    response = client.post(URL, json={**VALID, "password": password})
    assert response.status_code == 422
    assert error_code(response) == "validation_error"
    assert fragment in response.json()["error"]["fields"]["password"]


@pytest.mark.parametrize("email", ["not-an-email", "a@", "@b.com", "a b@c.com", ""])
def test_invalid_email_rejected(client, email):
    response = client.post(URL, json={**VALID, "email": email})
    assert response.status_code == 422
    assert "email" in response.json()["error"]["fields"]


@pytest.mark.parametrize("field", ["first_name", "last_name"])
def test_blank_names_rejected(client, field):
    response = client.post(URL, json={**VALID, field: "   "})
    assert response.status_code == 422
    assert field in response.json()["error"]["fields"]


def test_names_are_trimmed(client):
    response = client.post(URL, json={**VALID, "first_name": "  Ann  "})
    assert response.json()["user"]["first_name"] == "Ann"


def test_missing_fields_reported_together(client):
    response = client.post(URL, json={})
    assert response.status_code == 422
    assert set(response.json()["error"]["fields"]) == {
        "email",
        "password",
        "first_name",
        "last_name",
    }


def test_cannot_self_assign_admin_role(client, db):
    """Mass-assignment attack: extra fields are rejected, not silently applied."""
    response = client.post(URL, json={**VALID, "role": "admin"})
    assert response.status_code == 422
    assert "role" in response.json()["error"]["fields"]
    assert db.scalar(select(User).where(User.email == VALID["email"])) is None
