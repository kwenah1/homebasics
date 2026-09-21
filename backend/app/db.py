from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_session_factory = sessionmaker(autoflush=False, expire_on_commit=False)


@lru_cache
def get_engine() -> Engine:
    """Created on first use, so importing the app never needs a live database URL."""
    return create_engine(get_settings().database_url, pool_pre_ping=True)


def new_session() -> Session:
    return _session_factory(bind=get_engine())


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed."""
    db = new_session()
    try:
        yield db
    finally:
        db.close()
