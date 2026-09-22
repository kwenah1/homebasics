"""The bug-injection switch (scripts/bug_hunt.py) must be safe: typos fail loudly, prod never."""

import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.core import bugs
from app.core.bug_catalog import KNOWN_BUGS
from app.models import ShippingMethod
from app.services.pricing import shipping_for

PROD = {
    "environment": "prod",
    "jwt_secret": "x" * 40,
    "bcrypt_rounds": 12,
    "enable_test_endpoints": False,
}


@pytest.fixture
def inject(monkeypatch):
    def _inject(*names: str, **overrides):
        settings = get_settings().model_copy(update={"bug_injection": list(names), **overrides})
        monkeypatch.setattr(bugs, "get_settings", lambda: settings)

    return _inject


def test_off_by_default():
    assert not any(bugs.active(name) for name in KNOWN_BUGS)


def test_switching_one_on(inject):
    inject("free_shipping_off_by_one")
    assert bugs.active("free_shipping_off_by_one")
    assert not bugs.active("tax_on_shipping")
    assert shipping_for(ShippingMethod.STANDARD, 5000) == 599  # the bug really bites


def test_unknown_name_in_code_raises():
    with pytest.raises(KeyError):
        bugs.active("no_such_bug")


def test_unknown_name_in_env_is_rejected():
    with pytest.raises(ValidationError, match="unknown BUG_INJECTION"):
        Settings(_env_file=None, bug_injection="tax_on_shipping,typo_bug")


def test_env_value_is_comma_separated():
    s = Settings(_env_file=None, bug_injection=" tax_on_shipping , cart_allows_eleven ")
    assert s.bug_injection == ["tax_on_shipping", "cart_allows_eleven"]


def test_prod_refuses_bugs():
    with pytest.raises(ValidationError, match="BUG_INJECTION must be empty"):
        Settings(_env_file=None, bug_injection="tax_on_shipping", **PROD)


def test_never_active_in_prod_even_if_smuggled_in(inject):
    """Belt and braces: a settings object built without validation still can't enable one."""
    inject("tax_on_shipping", environment="prod")
    assert not bugs.active("tax_on_shipping")
