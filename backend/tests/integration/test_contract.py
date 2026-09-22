"""NFR-QUAL contract tests: Schemathesis generates requests from our own OpenAPI spec and checks
every response against it - never a 500, the documented status codes only, and bodies that
match the declared schemas.

The spec is the contract the React app (and anyone else) codes against, so a response that
drifts from it is a bug even when no hand-written test notices. Runs as the admin so the
protected endpoints are exercised too (anonymous 401s are covered by the RBAC matrix test).
Every example runs inside the test's rolled-back transaction, so nothing leaks.
"""

import pytest
import schemathesis
from hypothesis import HealthCheck, settings
from schemathesis.specs.openapi.checks import (
    content_type_conformance,
    response_schema_conformance,
    status_code_conformance,
)

from app.db import get_db
from app.main import create_app

CHECKS = [
    schemathesis.checks.not_a_server_error,
    status_code_conformance,
    content_type_conformance,
    response_schema_conformance,
]


@pytest.fixture
def api_schema(db, test_settings):
    # Test-support endpoints reset the database and move the clock (which expires the admin's
    # token mid-run): not part of the contract, so build the app without them.
    app = create_app(test_settings.model_copy(update={"enable_test_endpoints": False}))
    app.dependency_overrides[get_db] = lambda: db
    return schemathesis.openapi.from_asgi("/api/v1/openapi.json", app)


schema = schemathesis.pytest.from_fixture("api_schema")


@schema.parametrize()
@settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)
def test_api_honours_its_contract(case, admin_headers):
    case.call_and_validate(headers=admin_headers, checks=CHECKS)
