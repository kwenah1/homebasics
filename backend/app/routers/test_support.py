"""Test-only endpoints so E2E suites can put the app in a known state.

Mounted only when settings.test_endpoints_active (never in prod).
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.seed.run import reset_and_seed

router = APIRouter(prefix="/test", tags=["test-support"])


class ResetResponse(BaseModel):
    reset: bool
    seeded: dict[str, int]


@router.post("/reset", response_model=ResetResponse)
def reset_database(db: Session = Depends(get_db)) -> ResetResponse:
    """Wipe every table and reload the deterministic seed data."""
    return ResetResponse(reset=True, seeded=reset_and_seed(db))
