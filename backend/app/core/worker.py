"""Background worker (OPS-01): the jobs that must happen without a request.

* ORD-01 expiry sweep - unpaid orders release their stock even when nobody is shopping.
  (Requests still sweep too, so a single-instance deploy is correct either way.)
* EML-03 outbox delivery.

It runs inside the API process, which suits one small instance; the same `tick` is what a
separate worker process or a cron job would call.
"""

import asyncio
import contextlib
import logging

from sqlalchemy.orm import Session

from app.config import Settings
from app.db import new_session

logger = logging.getLogger("homebasics.worker")


def tick(db: Session, settings: Settings) -> dict[str, int]:
    """One pass. Never raises: a failing job must not stop the loop."""
    from app.services.email import send_pending
    from app.services.orders import expire_overdue

    result = {"expired": 0, "emails_sent": 0}
    for name, job in (("expired", expire_overdue), ("emails_sent", send_pending)):
        try:
            result[name] = job(db) if name == "expired" else job(db, settings)
        except Exception:  # noqa: BLE001 - logged, and tried again next tick
            logger.exception("worker job %s failed", name)
            db.rollback()
    return result


async def run_forever(settings: Settings, stop: asyncio.Event) -> None:
    while not stop.is_set():

        def run_tick() -> dict[str, int]:
            with new_session() as db:
                return tick(db, settings)

        done = await asyncio.to_thread(run_tick)
        if done["expired"] or done["emails_sent"]:
            logger.info("worker: %s", done)
        # Sleep until the next tick, but wake immediately on shutdown.
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=settings.worker_interval_seconds)
