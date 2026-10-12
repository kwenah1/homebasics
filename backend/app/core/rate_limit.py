"""Per-client rate limiting for the auth endpoints (NFR-SEC-01).

Sliding window keyed by (rule, client IP), over a pluggable store:

* in memory - the default; correct for one process (dev, tests, a single instance);
* Redis - shared, so the limit holds across instances and survives a restart (M9).

Both use the controllable clock, so tests travel instead of sleeping.
"""

import math
import threading
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

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


class Store(Protocol):
    """Records a hit. Returns the seconds to wait when the caller is over the limit."""

    def hit(self, rule: Rule, client: str, now: datetime) -> int | None: ...

    def reset(self) -> None: ...


def _retry_after(oldest: float, window: timedelta, now: float) -> int:
    return max(1, math.ceil(oldest + window.total_seconds() - now))


class InMemoryStore:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def hit(self, rule: Rule, client: str, now: datetime) -> int | None:
        with self._lock:
            hits = self._hits[(rule.name, client)]
            while hits and hits[0] <= now - rule.window:
                hits.popleft()
            if len(hits) >= rule.limit:
                return _retry_after(hits[0].timestamp(), rule.window, now.timestamp())
            hits.append(now)
            return None


class RedisStore:
    """The window is a sorted set of timestamps, one key per (rule, client).

    The hit is added first and taken back out if it turns out to be over the limit: two
    requests arriving together are then both counted, where check-then-add could let both
    through. Blocked attempts still don't extend the window.
    """

    def __init__(self, url: str) -> None:
        import redis  # kept local: the dependency is only needed when Redis is configured

        self._redis = redis.Redis.from_url(url, decode_responses=True)

    def reset(self) -> None:
        for key in self._redis.scan_iter("rl:*"):
            self._redis.delete(key)

    def hit(self, rule: Rule, client: str, now: datetime) -> int | None:
        key = f"rl:{rule.name}:{client}"
        score = now.timestamp()
        member = f"{score}:{uuid.uuid4().hex}"
        window = rule.window.total_seconds()

        pipe = self._redis.pipeline()
        pipe.zremrangebyscore(key, "-inf", score - window)
        pipe.zadd(key, {member: score})
        pipe.zcard(key)
        pipe.expire(key, int(window) + 1)
        count = pipe.execute()[2]

        if count > rule.limit:
            self._redis.zrem(key, member)  # over the limit: this attempt doesn't count
            oldest = self._redis.zrange(key, 0, 0, withscores=True)
            return _retry_after(oldest[0][1] if oldest else score, rule.window, score)
        return None


class RateLimiter:
    """One limiter per process; the store is chosen on first use from the settings."""

    def __init__(self, store: Store | None = None) -> None:
        self._store = store
        self._lock = threading.Lock()

    @property
    def store(self) -> Store:
        if self._store is None:
            with self._lock:
                if self._store is None:
                    url = get_settings().redis_url
                    self._store = RedisStore(url) if url else InMemoryStore()
        return self._store

    def use(self, store: Store | None) -> None:
        """Swap the store - app startup once settings are known, and tests."""
        self._store = store

    def reset(self) -> None:
        self.store.reset()

    def hit(self, rule: Rule, client: str) -> None:
        retry = self.store.hit(rule, client, clock.now())
        if retry is not None:
            raise AppError(
                429,
                "rate_limited",
                "Too many attempts. Please wait and try again.",
                headers={"Retry-After": str(retry)},
                extra={"retry_after_seconds": retry},
            )


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
