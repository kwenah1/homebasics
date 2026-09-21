"""ACC-05 profile + password change, and the ADM-04 role guard."""

from fastapi import APIRouter, Depends

from app.core.deps import require_admin
from app.models import User, UserRole
from tests.helpers import error_code, use_refresh

ME = "/api/v1/me"


class TestProfile:
    def test_update_names(self, client, customer):
        response = client.patch(ME, json={"first_name": " Jo ", "last_name": "Doe"})
        assert response.status_code == 200
        assert (response.json()["first_name"], response.json()["last_name"]) == ("Jo", "Doe")

    def test_partial_update_keeps_other_fields(self, client, customer):
        last = customer.last_name
        client.patch(ME, json={"first_name": "Jo"})
        assert client.get(ME).json()["last_name"] == last

    def test_blank_name_rejected(self, client, customer):
        response = client.patch(ME, json={"first_name": ""})
        assert response.status_code == 422

    def test_cannot_change_email_or_role(self, client, customer, db):
        for field, value in [("email", "x@homebasics.test"), ("role", "admin")]:
            response = client.patch(ME, json={field: value})
            assert response.status_code == 422, field
        db.refresh(customer)
        assert customer.role == UserRole.CUSTOMER

    def test_requires_auth(self, client):
        assert client.patch(ME, json={"first_name": "X"}).status_code == 401


class TestChangePassword:
    URL = f"{ME}/password"

    def test_change_password(self, client, customer, db):
        response = client.post(
            self.URL, json={"current_password": "Sparkle123", "new_password": "Glitter456"}
        )
        assert response.status_code == 200
        assert response.json()["access_token"]
        login = client.post(
            "/api/v1/auth/login", json={"email": customer.email, "password": "Glitter456"}
        )
        assert login.status_code == 200

    def test_wrong_current_password(self, client, customer):
        response = client.post(
            self.URL, json={"current_password": "WrongOne1", "new_password": "Glitter456"}
        )
        assert response.status_code == 400
        assert response.json()["error"]["fields"] == {
            "current_password": "Current password is incorrect."
        }

    def test_same_password_rejected(self, client, customer):
        response = client.post(
            self.URL, json={"current_password": "Sparkle123", "new_password": "Sparkle123"}
        )
        assert error_code(response) == "password_unchanged"

    def test_this_device_stays_signed_in_but_others_are_signed_out(self, client, customer):
        """Regression: the refresh cookie never reaches /me/password (path-scoped), so the
        endpoint must hand this device a brand-new session rather than 'keep' an old one."""
        old_this_device = client.cookies.get("hb_refresh")
        client.post("/api/v1/auth/login", json={"email": customer.email, "password": "Sparkle123"})
        other_device = client.cookies.get("hb_refresh")

        use_refresh(client, old_this_device)
        response = client.post(
            self.URL, json={"current_password": "Sparkle123", "new_password": "Glitter456"}
        )
        new_this_device = client.cookies.get("hb_refresh")

        assert new_this_device not in (None, old_this_device)
        assert client.post("/api/v1/auth/refresh").status_code == 200
        assert (
            client.get(
                ME, headers={"Authorization": f"Bearer {response.json()['access_token']}"}
            ).status_code
            == 200
        )
        for stale in (old_this_device, other_device):
            use_refresh(client, stale)
            assert client.post("/api/v1/auth/refresh").status_code == 401


class TestRoleGuard:
    """ADM-04 foundation: admin-only dependency. Mounted on a throwaway route for the test."""

    def mount(self, client):
        router = APIRouter()

        @router.get("/api/v1/_admin-probe")
        def probe(admin: User = Depends(require_admin)):
            return {"ok": True, "admin": admin.email}

        client.app.include_router(router)

    def test_customer_gets_403(self, client, customer):
        self.mount(client)
        response = client.get("/api/v1/_admin-probe")
        assert response.status_code == 403
        assert error_code(response) == "forbidden"

    def test_admin_allowed(self, client, auth_as):
        self.mount(client)
        auth_as("admin@homebasics.test", "Admin12345")
        assert client.get("/api/v1/_admin-probe").json() == {
            "ok": True,
            "admin": "admin@homebasics.test",
        }

    def test_anonymous_gets_401(self, client):
        self.mount(client)
        assert client.get("/api/v1/_admin-probe").status_code == 401

    def test_demotion_takes_effect_without_new_token(self, client, auth_as, db):
        self.mount(client)
        auth_as("admin@homebasics.test", "Admin12345")
        admin = db.query(User).filter_by(email="admin@homebasics.test").one()
        admin.role = UserRole.CUSTOMER
        db.flush()
        assert client.get("/api/v1/_admin-probe").status_code == 403
