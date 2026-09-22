"""Per-client rate limiting for the auth endpoints (NFR-SEC).

Sliding window, in memory, keyed by (rule, client IP). Uses the controllable clock, so tests
can travel instead of sleeping. One process only: several workers or instances would need a
shared store (e.g. Redis) - documented as a known limit.

Disabled by default in dev/test (the E2E suite signs in hundreds of times from 127.0.0.1)
and forced on in prod.
"""

import math
import threading
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Request

from app.config import get_settings
from app.core import clock
from app.core.errors import AppError


@dataclass(frozen=True)
class Rule:
    name: str
    limit: int
    window: timedelta


# Generous for people, tight for scripts. Login also has the per-account lockout (ACC-04).
RULES = {
    "login": Rule("login", 10, timedelta(minutes=1)),
    "register": Rule("register", 5, timedelta(minutes=10)),
    "forgot_password": Rule("forgot_password", 5, timedelta(minutes=15)),
    "refresh": Rule("refresh", 30, timedelta(minutes=1)),
    # Reset tokens are 256-bit, so guessing is hopeless anyway - this just stops the noise.
    "reset_password": Rule("reset_password", 10, timedelta(minutes=15)),
}


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def hit(self, rule: Rule, client: str) -> None:
        now = clock.now()
        with self._lock:
            hits = self._hits[(rule.name, client)]
            while hits and hits[0] <= now - rule.window:
                hits.popleft()
            if len(hits) >= rule.limit:
                retry = max(1, math.ceil((hits[0] + rule.window - now).total_seconds()))
                raise AppError(
                    429,
                    "rate_limited",
                    "Too many attempts. Please wait and try again.",
                    headers={"Retry-After": str(retry)},
                    extra={"retry_after_seconds": retry},
                )
            hits.append(now)


limiter = RateLimiter()


def client_key(request: Request) -> str:
    # Behind a trusted proxy this would read X-Forwarded-For; we deliberately don't trust it
    # here, or anyone could dodge the limit by sending a fake header.
    return request.client.host if request.client else "unknown"


def limit(rule_name: str):
    rule = RULES[rule_name]

    def dependency(request: Request) -> None:
        settings = getattr(request.app.state, "settings", None) or get_settings()
        if settings.rate_limit_active:
            limiter.hit(rule, client_key(request))

    return dependency
