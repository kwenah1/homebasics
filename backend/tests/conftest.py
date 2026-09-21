"""Shared fixtures.

Integration tests run against TEST_DATABASE_URL (a disposable database - it is wiped).
Each test runs inside a transaction that is rolled back, so tests never see each
other's writes, even when the code under test calls commit().
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Point the app at the test database *before* anything imports app.db.
_env_file = dotenv_values(BACKEND_DIR / ".env")
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or _env_file.get("TEST_DATABASE_URL")
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["ENVIRONMENT"] = "test"
os.environ["ENABLE_TEST_ENDPOINTS"] = "true"
os.environ["BCRYPT_ROUNDS"] = "4"  # ~60x faster hashing; policy logic is unchanged

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import Connection, create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import Settings, get_settings  # noqa: E402
from app.core import clock  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_clock():
    """Time travel in one test must never leak into the next."""
    clock.reset()
    yield
    clock.reset()


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Tests under tests/integration are auto-marked and skipped when no DB is configured."""
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL not set")
    for item in items:
        if "integration" in item.path.parts:
            item.add_marker(pytest.mark.integration)
            if not TEST_DATABASE_URL:
                item.add_marker(skip)
        elif "unit" in item.path.parts:
            item.add_marker(pytest.mark.unit)


@pytest.fixture(scope="session")
def engine():
    from alembic.config import Config

    from alembic import command

    settings = get_settings()
    eng = create_engine(settings.database_url, pool_pre_ping=True)

    # Fresh schema every run, built by the real migrations (so migrations are tested too).
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["database_url"] = settings.database_url
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")

    from app.seed.run import seed

    with Session(eng) as db:
        seed(db)

    yield eng
    eng.dispose()


@pytest.fixture
def connection(engine) -> Iterator[Connection]:
    conn = engine.connect()
    trans = conn.begin()
    try:
        yield conn
    finally:
        trans.rollback()
        conn.close()


@pytest.fixture
def db(connection: Connection) -> Iterator[Session]:
    # commit() inside the code under test only releases a SAVEPOINT; the outer rollback wins.
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_settings() -> Settings:
    return get_settings().model_copy(update={"environment": "test", "enable_test_endpoints": True})


@pytest.fixture
def client(db: Session, test_settings: Settings) -> Iterator[TestClient]:
    from app.db import get_db
    from app.main import create_app

    app = create_app(test_settings)
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c


@pytest.fixture
def make_user(db):
    """Factory: make_user(email=..., password=..., role=...) -> (User, password)."""
    from tests.factories import DEFAULT_PASSWORD, UserFactory

    def _make(password: str = DEFAULT_PASSWORD, **fields):
        UserFactory._meta.sqlalchemy_session = db
        return UserFactory(password=password, **fields), password

    return _make


@pytest.fixture
def auth_as(client):
    """auth_as(email, password) logs the TestClient in and sets the Bearer header."""

    def _login(email: str, password: str) -> dict:
        response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert response.status_code == 200, response.text
        body = response.json()
        client.headers["Authorization"] = f"Bearer {body['access_token']}"
        return body

    return _login


@pytest.fixture
def customer(make_user, auth_as):
    """A fresh, signed-in customer (not a seed user, so tests can mutate it freely)."""
    user, password = make_user()
    auth_as(user.email, password)
    return user
