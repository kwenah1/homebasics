"""NFR-SEC-01: both rate-limit stores must behave the same. The Redis one is what makes the
limit hold across instances (M9) - tested against fakeredis, no server needed."""

from datetime import timedelta

import fakeredis
import pytest

from app.core import clock
from app.core.rate_limit import InMemoryStore, RedisStore, Rule
from tests.helpers import travel

RULE = Rule("login", 3, timedelta(minutes=1))


@pytest.fixture(params=["memory", "redis"])
def store(request, monkeypatch):
    if request.param == "memory":
        return InMemoryStore()
    monkeypatch.setattr(
        "redis.Redis.from_url", lambda *a, **kw: fakeredis.FakeStrictRedis(decode_responses=True)
    )
    return RedisStore("redis://unused")


@pytest.fixture(autouse=True)
def _frozen(frozen_clock):
    return


def hit(store, client="1.2.3.4"):
    return store.hit(RULE, client, clock.now())


def test_allows_up_to_the_limit_then_blocks(store):
    assert [hit(store) for _ in range(3)] == [None, None, None]
    assert hit(store) == 60


def test_blocked_attempts_do_not_extend_the_window(store):
    for _ in range(3):
        hit(store)
    travel(seconds=30)
    assert hit(store) == 30  # still blocked, and the wait is counted from the oldest hit
    travel(seconds=30)
    assert hit(store) is None


def test_clients_are_independent(store):
    for _ in range(3):
        hit(store, "1.1.1.1")
    assert hit(store, "1.1.1.1") == 60
    assert hit(store, "2.2.2.2") is None


def test_rules_are_independent(store):
    other = Rule("register", 1, timedelta(minutes=10))
    for _ in range(3):
        hit(store)
    assert store.hit(other, "1.2.3.4", clock.now()) is None


def test_window_slides(store):
    for _ in range(3):
        hit(store)
        travel(seconds=10)
    travel(seconds=31)  # the first hit (61 s ago) has dropped out
    assert hit(store) is None


def test_reset_clears_everything(store):
    for _ in range(3):
        hit(store)
    store.reset()
    assert hit(store) is None
