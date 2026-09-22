"""One error shape for every non-2xx response:

    {"error": {"code": "invalid_credentials", "message": "...", "fields": {...}?}}

``code`` is stable and machine-readable (tests and the frontend switch on it);
``message`` is human text and may change.
"""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        fields: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields
        self.headers = headers
        self.extra = extra or {}


def error_body(code: str, message: str, fields: dict[str, str] | None = None, **extra: Any):
    body: dict[str, Any] = {"code": code, "message": message, **extra}
    if fields:
        body["fields"] = fields
    return {"error": body}


def _field_name(loc: tuple[Any, ...]) -> str:
    # ("body", "address", "state") -> "address.state"; drop the "body"/"query" prefix.
    parts = [str(p) for p in loc[1:]] if loc and loc[0] in {"body", "query", "path"} else loc
    return ".".join(str(p) for p in parts) or "request"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code, exc.message, exc.fields, **exc.extra),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields: dict[str, str] = {}
        for err in exc.errors():
            message = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
            fields.setdefault(_field_name(tuple(err.get("loc", ()))), message)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=error_body("validation_error", "Some fields are invalid.", fields),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 400 and exc.detail == "There was an error parsing the body":
            # Found by the contract test: a body that isn't even decodable (bad UTF-8) got an
            # undocumented 400. It's invalid input like any other, so it's a documented 422.
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                content=error_body("invalid_body", "The request body could not be read."),
            )
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, str(exc.detail)),
            headers=getattr(exc, "headers", None),
        )
