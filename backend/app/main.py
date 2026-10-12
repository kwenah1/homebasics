import asyncio
import contextlib
import logging
import time
import uuid
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.core import worker
from app.core.errors import install_error_handlers
from app.core.openapi import document_errors
from app.core.rate_limit import InMemoryStore, RedisStore, limiter
from app.routers import (
    admin,
    auth,
    cart,
    catalog,
    health,
    me,
    meta,
    orders,
    returns,
    reviews,
    test_support,
    wishlist,
)

API_PREFIX = "/api/v1"
logger = logging.getLogger("homebasics.request")


def _install_sentry(settings: Settings) -> None:
    """Optional: only when a DSN is configured, so dev and CI stay offline."""
    if not settings.sentry_dsn:
        return
    try:
        import sentry_sdk
    except ImportError:  # pragma: no cover - the extra isn't installed
        logger.warning("SENTRY_DSN is set but sentry-sdk isn't installed")
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn, environment=settings.environment, send_default_pii=False
    )


def lifespan_for(settings: Settings):
    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        _install_sentry(settings)
        # The limiter is process-wide, so point it at the store this app's settings ask for.
        limiter.use(RedisStore(settings.redis_url) if settings.redis_url else InMemoryStore())

        stop = asyncio.Event()
        task = (
            asyncio.create_task(worker.run_forever(settings, stop))
            if settings.worker_enabled
            else None
        )
        try:
            yield
        finally:
            if task is not None:
                stop.set()
                with contextlib.suppress(asyncio.CancelledError, TimeoutError):
                    await asyncio.wait_for(task, timeout=10)

    return lifespan


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        lifespan=lifespan_for(settings),
    )

    app.state.settings = settings  # per-app config (tests build apps with their own)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next) -> Response:
        """Tag every request with an ID (echoed back) and log its timing."""
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # NFR-SEC-04 (nightly ZAP): API responses are only for our own pages.
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        logger.info(
            "%s %s %s %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
            extra={"request_id": request_id},
        )
        return response

    install_error_handlers(app)
    app.include_router(document_errors(health.router), prefix=API_PREFIX)
    app.include_router(document_errors(auth.router), prefix=API_PREFIX)
    app.include_router(document_errors(me.router), prefix=API_PREFIX)
    app.include_router(document_errors(wishlist.router), prefix=API_PREFIX)
    app.include_router(document_errors(meta.router), prefix=API_PREFIX)
    app.include_router(document_errors(catalog.router), prefix=API_PREFIX)
    app.include_router(document_errors(reviews.router), prefix=API_PREFIX)
    app.include_router(document_errors(cart.router), prefix=API_PREFIX)
    app.include_router(document_errors(orders.checkout), prefix=API_PREFIX)
    app.include_router(document_errors(orders.orders), prefix=API_PREFIX)
    app.include_router(document_errors(returns.router), prefix=API_PREFIX)
    app.include_router(document_errors(admin.router), prefix=API_PREFIX)
    if settings.test_endpoints_active:
        app.include_router(document_errors(test_support.router), prefix=API_PREFIX)

    return app


app = create_app()
