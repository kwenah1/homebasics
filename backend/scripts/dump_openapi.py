"""Write the OpenAPI spec to docs/openapi.json.

The spec is the contract the web app's types are generated from (M10) and what Schemathesis
fuzzes (M7). Committing it means a pull request *shows* an API change in its diff, and CI can
fail when the committed copy drifts from the code.

    python scripts/dump_openapi.py [--check]
"""

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

OUT = BACKEND.parent / "docs" / "openapi.json"


def spec() -> str:
    from app.config import get_settings
    from app.main import create_app

    # Test endpoints are never part of the published contract.
    settings = get_settings().model_copy(update={"enable_test_endpoints": False})
    return json.dumps(create_app(settings).openapi(), indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the committed spec is stale")
    args = parser.parse_args()

    current = spec()
    if args.check:
        on_disk = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if on_disk != current:
            print(f"{OUT.name} is out of date - run: python scripts/dump_openapi.py")
            return 1
        print(f"{OUT.name} matches the code")
        return 0

    OUT.write_text(current, encoding="utf-8", newline="\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
