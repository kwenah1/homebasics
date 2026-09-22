"""Regressions for the defects the Schemathesis contract test found (M7). Each used to be a 500
or an undocumented response; the contract test would catch them again, but these pin them
down by name and run in milliseconds."""

import pytest

from app.main import create_app
from app.schemas.types import INT4_MAX
from tests.helpers import error_code

NUL = "\x00"


@pytest.mark.parametrize(
    "path",
    [
        f"/api/v1/admin/products/{INT4_MAX + 1}",
        f"/api/v1/admin/products?category_id={INT4_MAX + 1}",
        "/api/v1/admin/products?page=10001",
        "/api/v1/admin/orders?page=99999999999999999999",
        f"/api/v1/products?min_price_cents={INT4_MAX + 1}",
    ],
)
def test_out_of_range_numbers_are_422_not_500(client, admin_headers, path):
    response = client.get(path, headers=admin_headers)
    assert response.status_code == 422
    assert error_code(response) == "validation_error"


def test_out_of_range_id_in_a_body_is_422(client, customer):
    response = client.post("/api/v1/cart/items", json={"product_id": INT4_MAX + 1, "quantity": 1})
    assert response.status_code == 422
    assert "product_id" in response.json()["error"]["fields"]


def test_largest_valid_id_is_just_not_found(client, admin_headers):
    response = client.get(f"/api/v1/admin/products/{INT4_MAX}", headers=admin_headers)
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/api/v1/auth/login", {"email": "a@e2e.test", "password": f"x{NUL}y"}),
        ("post", "/api/v1/admin/categories", {"name": f"Bad{NUL}Name"}),
        ("get", "/api/v1/products?q=soap%00", None),
        ("get", "/api/v1/admin/orders?q=HB%00", None),
    ],
)
def test_nul_bytes_are_422_not_500(client, admin_headers, method, path, body):
    kwargs = {"json": body} if body is not None else {}
    response = client.request(method.upper(), path, headers=admin_headers, **kwargs)
    assert response.status_code == 422, response.text
    assert "NUL" in str(response.json()["error"].get("fields", {}))


def test_nul_in_a_path_is_422(client):
    response = client.get("/api/v1/products/soap%00")
    assert response.status_code == 422


def test_unreadable_body_is_422(client):
    response = client.post(
        "/api/v1/auth/register",
        content=b'{"email": "\xff\xfe"}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert error_code(response) == "invalid_body"


class TestSpecDocumentsErrors:
    @pytest.fixture(scope="class")
    def spec(self):
        return create_app().openapi()

    def responses(self, spec, method, path):
        return set(spec["paths"][f"/api/v1{path}"][method]["responses"])

    def test_signed_in_routes_document_401(self, spec):
        assert "401" in self.responses(spec, "get", "/me")
        assert "401" in self.responses(spec, "post", "/checkout/place-order")

    def test_admin_routes_document_401_and_403(self, spec):
        assert {"401", "403"} <= self.responses(spec, "get", "/admin/summary")

    def test_public_routes_do_not_claim_401(self, spec):
        assert "401" not in self.responses(spec, "get", "/products")

    def test_path_params_document_404_and_422(self, spec):
        assert {"404", "422"} <= self.responses(spec, "get", "/products/{slug}")

    def test_errors_use_our_error_shape(self, spec):
        """Not FastAPI's default {"detail": [...]}, which we never actually send."""
        assert "HTTPValidationError" not in spec["components"]["schemas"]
        schema = spec["paths"]["/api/v1/me"]["get"]["responses"]["401"]["content"]
        assert schema["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")
