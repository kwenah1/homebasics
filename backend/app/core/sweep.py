"""Dependency: expire overdue unpaid orders before any request that reads or reserves stock.

Regression (found by an integration test): the sweep used to run only at checkout, so stock
held by abandoned orders stayed invisible in the catalog and cart - the next shopper couldn't
even add the item. The query is cheap (index on status + payment_expires_at, SKIP LOCKED).
A production deployment would also run it on a schedule.
"""

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db import get_db


def release_expired_stock(db: Session = Depends(get_db)) -> None:
    from app.services.orders import expire_overdue  # local import avoids a cycle

    expire_overdue(db)
