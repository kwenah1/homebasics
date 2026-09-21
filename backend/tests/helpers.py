from datetime import timedelta

from app.core import clock


def error_code(response) -> str:
    return response.json()["error"]["code"]


def travel(**kwargs) -> None:
    """travel(minutes=15, seconds=1) - move the app clock forward."""
    clock.advance(timedelta(**kwargs))


def use_refresh(client, raw: str) -> None:
    """Simulate a device holding this refresh token.

    httpx keys cookies by (domain, path, name). TestClient's server-set cookies live on
    "testserver.local", so we set ours there too - otherwise the next Set-Cookie adds a
    *second* hb_refresh instead of replacing it.
    """
    client.cookies.clear()
    client.cookies.set("hb_refresh", raw, domain="testserver.local", path="/api/v1/auth")


VALID_ADDRESS = {
    "label": "Home",
    "recipient_name": "Casey Customer",
    "line1": "100 Congress Ave",
    "city": "Austin",
    "state": "TX",
    "postal_code": "78701",
}
