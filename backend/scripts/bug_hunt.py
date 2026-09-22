"""Prove the tests work: switch on each known bug in turn and check the suite goes red.

    python scripts/bug_hunt.py              # every bug in app/core/bug_catalog.py
    python scripts/bug_hunt.py tax_on_shipping cart_allows_eleven

A green run with a bug switched on means a hole in the tests. The script exits 1 if any bug
survives. Each run targets the tests for the rule the bug breaks (and stops at the first
failure), so the whole hunt takes a few minutes rather than ten full suite runs.
Runs one at a time: every pytest run drops and rebuilds the test database.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.core.bug_catalog import KNOWN_BUGS  # noqa: E402

T = "tests/"
TARGETS: dict[str, list[str]] = {
    "free_shipping_off_by_one": [T + "unit/test_pricing.py", T + "integration/test_checkout.py"],
    "tax_rounds_per_line": [T + "unit/test_pricing.py", T + "integration/test_checkout.py"],
    "tax_on_shipping": [T + "unit/test_pricing.py", T + "integration/test_checkout.py"],
    "cart_allows_eleven": [T + "unit/test_cart_rules.py", T + "integration/test_cart.py"],
    "low_stock_threshold_off_by_one": [T + "unit/test_catalog_rules.py"],
    "search_wildcards_unescaped": [
        T + "unit/test_catalog_rules.py",
        T + "integration/test_catalog.py",
    ],
    "archived_products_listed": [
        T + "integration/test_catalog.py",
        T + "integration/test_admin.py",
    ],
    "lockout_after_six": [T + "integration/test_auth_login.py"],
    "stock_not_restored_on_cancel": [
        T + "integration/test_checkout.py",
        T + "integration/test_admin.py",
    ],
    "idempotency_ignored": [T + "integration/test_checkout.py"],
}


def hunt(bug: str) -> tuple[bool, float, str]:
    env = {**os.environ, "BUG_INJECTION": bug}
    started = time.monotonic()
    result = subprocess.run(  # noqa: S603 - fixed argv, bug names come from KNOWN_BUGS
        [
            sys.executable,
            "-m",
            "pytest",
            "-x",
            "-q",
            "-p",
            "no:cacheprovider",
            "--no-cov",
            *TARGETS[bug],
        ],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
    )
    failed = [line for line in result.stdout.splitlines() if line.startswith("FAILED")]
    # Exit code 1 = tests failed. Anything else (2 = collection error, 4 = bad usage) means the
    # run broke, which is not the same as the tests catching the bug.
    if result.returncode not in (0, 1):
        raise SystemExit(f"{bug}: pytest exited {result.returncode}\n{result.stdout[-2000:]}")
    return result.returncode == 1, time.monotonic() - started, failed[0] if failed else ""


def main(names: list[str]) -> int:
    missing = set(KNOWN_BUGS) - set(TARGETS)
    if missing:
        print(f"no targets for: {sorted(missing)}")
        return 2
    survivors = []
    for bug in names or list(KNOWN_BUGS):
        caught, seconds, first = hunt(bug)
        mark = "caught " if caught else "MISSED "
        print(f"{mark} {bug:32} {seconds:5.0f}s  {first[:90] if caught else KNOWN_BUGS[bug]}")
        if not caught:
            survivors.append(bug)
    print(f"\n{len(names or KNOWN_BUGS) - len(survivors)} caught, {len(survivors)} missed")
    return 1 if survivors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
