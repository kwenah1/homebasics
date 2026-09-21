"""ACC-03: access token use, refresh rotation, reuse detection, logout."""

from tests.helpers import error_code, travel, use_refresh

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/me"


def sign_in(client, make_user):
    user, pw = make_user()
    body = client.post(LOGIN, json={"email": user.email, "password": pw}).json()
    return user, body["access_token"], client.cookies.get("hb_refresh")


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


class TestAccessToken:
    def test_me_requires_a_token(self, client):
        response = client.get(ME)
        assert response.status_code == 401
        assert error_code(response) == "not_authenticated"
        assert response.headers["WWW-Authenticate"] == "Bearer"

    def test_me_with_token(self, client, make_user):
        user, token, _ = sign_in(client, make_user)
        response = client.get(ME, headers=bearer(token))
        assert response.status_code == 200
        assert response.json()["email"] == user.email

    def test_expired_access_token(self, client, make_user):
        _, token, _ = sign_in(client, make_user)
        travel(minutes=15)
        response = client.get(ME, headers=bearer(token))
        assert response.status_code == 401
        assert error_code(response) == "token_expired"

    def test_tampered_token(self, client, make_user):
        _, token, _ = sign_in(client, make_user)
        tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
        assert error_code(client.get(ME, headers=bearer(tampered))) == "invalid_token"

    def test_token_for_deleted_user(self, client, db, make_user):
        user, token, _ = sign_in(client, make_user)
        db.delete(user)
        db.flush()
        assert error_code(client.get(ME, headers=bearer(token))) == "invalid_token"

    def test_wrong_auth_scheme(self, client, make_user):
        _, token, _ = sign_in(client, make_user)
        response = client.get(ME, headers={"Authorization": f"Basic {token}"})
        assert response.status_code == 401


class TestRefresh:
    def test_refresh_issues_new_access_token_and_rotates_cookie(self, client, make_user):
        user, _, first = sign_in(client, make_user)

        response = client.post(REFRESH)

        assert response.status_code == 200
        assert response.json()["user"]["id"] == user.id
        second = client.cookies.get("hb_refresh")
        assert second and second != first
        assert client.get(ME, headers=bearer(response.json()["access_token"])).status_code == 200

    def test_refresh_works_after_access_token_expired(self, client, make_user):
        sign_in(client, make_user)
        travel(hours=1)
        assert client.post(REFRESH).status_code == 200

    def test_refresh_without_cookie(self, client):
        response = client.post(REFRESH)
        assert response.status_code == 401
        assert error_code(response) == "invalid_refresh_token"

    def test_refresh_expires_after_seven_days(self, client, make_user):
        sign_in(client, make_user)
        travel(days=7)
        response = client.post(REFRESH)
        assert error_code(response) == "refresh_token_expired"
        assert "hb_refresh" not in client.cookies  # cleared on failure

    def test_reusing_a_rotated_token_revokes_the_whole_family(self, client, make_user):
        """Theft detection: attacker replays an old token -> both parties are signed out."""
        _, _, stolen = sign_in(client, make_user)
        assert client.post(REFRESH).status_code == 200  # legit user rotates
        current = client.cookies.get("hb_refresh")

        use_refresh(client, stolen)
        replay = client.post(REFRESH)
        assert replay.status_code == 401
        assert error_code(replay) == "refresh_token_reused"

        use_refresh(client, current)
        assert error_code(client.post(REFRESH)) == "refresh_token_reused"

    def test_other_logins_unaffected_by_family_revocation(self, client, make_user):
        user, pw = make_user()
        client.post(LOGIN, json={"email": user.email, "password": pw})
        device_a = client.cookies.get("hb_refresh")
        client.cookies.clear()
        client.post(LOGIN, json={"email": user.email, "password": pw})
        device_b = client.cookies.get("hb_refresh")

        use_refresh(client, device_a)
        client.post(REFRESH)
        use_refresh(client, device_a)
        client.post(REFRESH)  # replay -> device A family revoked

        use_refresh(client, device_b)
        assert client.post(REFRESH).status_code == 200


class TestLogout:
    def test_logout_revokes_refresh_and_clears_cookie(self, client, make_user):
        _, _, raw = sign_in(client, make_user)

        response = client.post(LOGOUT)
        assert response.status_code == 204
        assert 'hb_refresh=""' in response.headers["set-cookie"]

        use_refresh(client, raw)
        assert client.post(REFRESH).status_code == 401

    def test_logout_without_session_is_harmless(self, client):
        assert client.post(LOGOUT).status_code == 204
