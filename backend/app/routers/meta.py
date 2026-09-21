from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import TaxRate

router = APIRouter(tags=["meta"])


class StateOut(BaseModel):
    code: str
    name: str


@router.get("/states", response_model=list[StateOut])
def list_states(db: Session = Depends(get_db)) -> list[StateOut]:
    """Ship-to states. Same table the address and tax rules validate against."""
    rows = db.execute(select(TaxRate.state_code, TaxRate.state_name).order_by(TaxRate.state_name))
    return [StateOut(code=code, name=name) for code, name in rows]
