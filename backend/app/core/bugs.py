"""`bugs.active("name")` - is a deliberate defect switched on? (see bug_catalog.py)"""

from app.config import get_settings
from app.core.bug_catalog import KNOWN_BUGS


def active(name: str) -> bool:
    if name not in KNOWN_BUGS:  # a typo in a hook must fail loudly, not silently do nothing
        raise KeyError(f"unknown bug {name!r}")
    settings = get_settings()
    return settings.environment != "prod" and name in settings.bug_injection
