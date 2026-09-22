"""Document the error responses each route can really return, derived from its dependencies.

Found by the Schemathesis contract test: the spec listed only the success code and 422, so
a client generated from it had no idea a 401, 403 or 404 could come back - and every error
body was undeclared. Deriving them keeps the spec honest as routes are added: a route that
depends on get_current_user can 401, on require_admin can 403, with a path parameter can 404.
Route-specific codes (402, 409, 429...) are still declared on the route itself.
"""

from collections.abc import Callable, Iterator

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, APIRouter
from pydantic import BaseModel, ConfigDict

from app.core.deps import get_current_user, require_admin


class ErrorDetail(BaseModel):
    model_config = ConfigDict(extra="allow")  # e.g. retry_after_seconds, current_price_cents

    code: str
    message: str
    fields: dict[str, str] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


def _calls(dependant: Dependant) -> Iterator[Callable]:
    for dep in dependant.dependencies:
        if dep.call is not None:
            yield dep.call
        yield from _calls(dep)


def _error(description: str) -> dict:
    return {"description": description, "model": ErrorResponse}


def document_errors(router: APIRouter) -> APIRouter:
    """Call before include_router. Idempotent, so building several apps is fine."""
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        calls = set(_calls(route.dependant))
        derived: dict[int | str, dict] = {}
        if get_current_user in calls:
            derived[401] = _error("Not signed in, or the access token is invalid or expired")
        if require_admin in calls:
            derived[403] = _error("Signed in, but not an admin")
        if route.dependant.path_params:
            derived[404] = _error("No such resource (or it isn't yours)")
        d = route.dependant
        if d.body_params or d.query_params or d.header_params or d.cookie_params or d.path_params:
            derived[422] = _error("Invalid input - `fields` says which and why")
        for code, spec in route.responses.items():  # the route's own wording wins
            derived[code] = {"model": ErrorResponse, **spec} if int(code) >= 400 else spec
        route.responses = derived
    return router
