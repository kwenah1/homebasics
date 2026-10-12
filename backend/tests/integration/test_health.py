from unittest.mock import MagicMock

from sqlalchemy.exc import OperationalError

from app.db import get_db


def test_health_ok(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "ok",
        "version": "0.1.0",
        "environment": "test",
    }


def test_health_reports_503_when_database_is_down(client):
    broken = MagicMock()
    broken.execute.side_effect = OperationalError("SELECT 1", {}, Exception("connection refused"))
    client.app.dependency_overrides[get_db] = lambda: broken

    response = client.get("/api/v1/health")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["database"] == "unavailable"


def test_request_id_is_generated(client):
    response = client.get("/api/v1/health")
    assert len(response.headers["X-Request-ID"]) == 32


def test_request_id_is_echoed_back(client):
    response = client.get("/api/v1/health", headers={"X-Request-ID": "trace-abc-123"})
    assert response.headers["X-Request-ID"] == "trace-abc-123"


def test_security_headers(client):
    headers = client.get("/api/v1/health").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Cross-Origin-Resource-Policy"] == "same-origin"


def test_cors_allows_frontend_origin(client):
    response = client.options(
        "/api/v1/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_unknown_origin(client):
    response = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_openapi_spec_is_published(client):
    spec = client.get("/api/v1/openapi.json").json()
    assert spec["info"]["title"] == "HomeBasics API"
    assert "/api/v1/health" in spec["paths"]
