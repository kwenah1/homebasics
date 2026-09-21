"""ACC-05 address book: CRUD, max 5, exactly one default, ownership (IDOR)."""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Address
from tests.factories import AddressFactory
from tests.helpers import VALID_ADDRESS, error_code

URL = "/api/v1/me/addresses"


def add(client, **overrides):
    return client.post(URL, json={**VALID_ADDRESS, **overrides})


def defaults(client):
    return [a["id"] for a in client.get(URL).json() if a["is_default"]]


class TestCreate:
    def test_first_address_becomes_default(self, client, customer):
        response = add(client)
        assert response.status_code == 201
        assert response.json()["is_default"] is True
        assert response.json()["state"] == "TX"

    def test_second_address_is_not_default_unless_asked(self, client, customer):
        first = add(client).json()
        second = add(client, label="Work").json()
        assert second["is_default"] is False
        assert defaults(client) == [first["id"]]

    def test_new_default_replaces_old(self, client, customer):
        add(client)
        second = add(client, label="Work", is_default=True).json()
        assert defaults(client) == [second["id"]]

    def test_state_is_uppercased(self, client, customer):
        assert add(client, state="ca").json()["state"] == "CA"

    @pytest.mark.parametrize("postal", ["78701", "78701-1234"])
    def test_valid_postal_codes(self, client, customer, postal):
        assert add(client, postal_code=postal).status_code == 201

    @pytest.mark.parametrize("postal", ["7870", "787011", "78701-12", "ABCDE", ""])
    def test_invalid_postal_codes(self, client, customer, postal):
        response = add(client, postal_code=postal)
        assert response.status_code == 422
        assert "postal_code" in response.json()["error"]["fields"]

    @pytest.mark.parametrize("state", ["ZZ", "XX", "PR"])
    def test_unknown_state_codes(self, client, customer, state):
        response = add(client, state=state)
        assert response.status_code == 422
        assert response.json()["error"]["fields"] == {"state": "Unknown US state code."}

    @pytest.mark.parametrize("state", ["T", "TEX", "1X"])
    def test_malformed_state_codes(self, client, customer, state):
        assert add(client, state=state).status_code == 422

    def test_blank_line2_stored_as_null(self, client, customer):
        assert add(client, line2="   ").json()["line2"] is None

    def test_limit_of_five(self, client, customer):
        """Boundary: 5th succeeds, 6th fails."""
        statuses = [add(client, label=f"A{i}").status_code for i in range(6)]
        assert statuses == [201] * 5 + [409]
        assert error_code(add(client)) == "address_limit_reached"

    def test_requires_auth(self, client):
        assert add(client).status_code == 401


class TestUpdateAndDelete:
    def test_partial_update(self, client, customer):
        address = add(client).json()
        response = client.patch(f"{URL}/{address['id']}", json={"city": "Houston"})
        assert response.status_code == 200
        assert response.json()["city"] == "Houston"
        assert response.json()["line1"] == VALID_ADDRESS["line1"]

    def test_required_field_cannot_be_nulled(self, client, customer):
        address = add(client).json()
        response = client.patch(f"{URL}/{address['id']}", json={"city": None})
        assert response.status_code == 422

    def test_update_validates_state(self, client, customer):
        address = add(client).json()
        response = client.patch(f"{URL}/{address['id']}", json={"state": "ZZ"})
        assert response.status_code == 422

    def test_set_default(self, client, customer):
        add(client)
        second = add(client, label="Work").json()
        response = client.post(f"{URL}/{second['id']}/default")
        assert response.json()["is_default"] is True
        assert defaults(client) == [second["id"]]

    def test_deleting_default_promotes_oldest_remaining(self, client, customer):
        first = add(client).json()
        second = add(client, label="Work").json()
        third = add(client, label="Gym").json()
        client.post(f"{URL}/{third['id']}/default")

        assert client.delete(f"{URL}/{third['id']}").status_code == 204
        assert defaults(client) == [first["id"]]
        assert {a["id"] for a in client.get(URL).json()} == {first["id"], second["id"]}

    def test_deleting_last_address_leaves_empty_book(self, client, customer):
        only = add(client).json()
        client.delete(f"{URL}/{only['id']}")
        assert client.get(URL).json() == []

    def test_list_puts_default_first(self, client, customer):
        add(client)
        second = add(client, label="Work", is_default=True).json()
        assert client.get(URL).json()[0]["id"] == second["id"]


class TestOwnership:
    """IDOR: another user's address must look exactly like a missing one."""

    @pytest.fixture
    def someone_elses_address(self, db, make_user):
        other, _ = make_user()
        AddressFactory._meta.sqlalchemy_session = db
        return AddressFactory(user_id=other.id, is_default=True)

    @pytest.mark.parametrize(
        ("method", "suffix", "body"),
        [
            ("patch", "", {"city": "Hacked"}),
            ("delete", "", None),
            ("post", "/default", None),
        ],
    )
    def test_cannot_touch_other_users_address(
        self, client, customer, someone_elses_address, db, method, suffix, body
    ):
        url = f"{URL}/{someone_elses_address.id}{suffix}"
        response = client.request(method, url, json=body)
        missing = client.request(method, f"{URL}/999999{suffix}", json=body)

        assert response.status_code == missing.status_code == 404
        assert response.json() == missing.json()
        db.refresh(someone_elses_address)
        assert someone_elses_address.city == "Austin"

    def test_list_only_shows_own_addresses(self, client, customer, someone_elses_address):
        assert client.get(URL).json() == []


def test_database_enforces_single_default(db, make_user):
    """Even if the service had a bug, Postgres refuses two defaults for one user."""
    user, _ = make_user()
    AddressFactory._meta.sqlalchemy_session = db
    AddressFactory(user_id=user.id, is_default=True)
    with pytest.raises(IntegrityError, match="uq_addresses_one_default_per_user"):
        AddressFactory(user_id=user.id, is_default=True)
    db.rollback()
    assert Address  # keep import used
