"""Mutation testing for the money maths (M10).

`scripts/bug_hunt.py` checks the bugs *we thought of*. This checks the ones we didn't:
cosmic-ray rewrites operators and constants in the pure pricing and refund modules and reruns
their unit tests. A mutant that survives is a change to the rules no test objects to - a hole.

    python scripts/mutation.py            # every target; fails if any mutant survives
    python scripts/mutation.py refunds    # just one

Only pure modules are targeted: their unit tests need no database, so a mutant costs about a
second. Mutating the database services would mostly produce mutants no unit test can reach.
"""

import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
CR = [sys.executable, "-m", "cosmic_ray.cli"]  # the console script isn't on PATH in a venv


@dataclass(frozen=True)
class Target:
    name: str
    module: str
    tests: str  # the smallest test set covering it, so each mutant runs fast


# The whole unit suite runs for each mutant: it needs no database (~3 s), and picking a
# single file per module silently ignores the property tests in the others - which made 36
# mutants look like survivors when the tests covering them simply weren't being run.
TARGETS = [
    Target("pricing", "app/services/pricing.py", "tests/unit"),
    Target("refunds", "app/services/refunds.py", "tests/unit"),
]

# Mutants that cannot change behaviour for inputs the function can actually receive, so no
# test could kill them. Each needs a reason; anything *not* listed here fails the run.
EQUIVALENT: dict[str, str] = {}  # filled in below, once a run shows which ones are real


def config_for(target: Target, workdir: Path) -> Path:
    python = sys.executable.replace("\\", "/")
    config = workdir / f"{target.name}.toml"
    config.write_text(
        f"""[cosmic-ray]
module-path = "{target.module}"
timeout = 60.0
test-command = "{python} -m pytest -x -q --no-cov -p no:cacheprovider {target.tests}"

[cosmic-ray.distributor]
name = "local"
""",
        encoding="utf-8",
    )
    return config


def _cosmic_ray(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=BACKEND, capture_output=True, text=True)  # noqa: S603


def run(target: Target, workdir: Path) -> tuple[int, list[str], list[str]]:
    """Returns (mutants tested, unexplained survivors, known-equivalent survivors)."""
    config = config_for(target, workdir)
    session = workdir / f"{target.name}.sqlite"
    for command in (
        [*CR, "init", str(config), str(session)],
        [*CR, "exec", str(config), str(session)],
    ):
        result = _cosmic_ray(command)
        if result.returncode != 0:
            raise SystemExit(f"cosmic-ray {command[3]} failed:\n{result.stderr[-2000:]}")

    tested, survivors, known = 0, [], []
    for line in _cosmic_ray([*CR, "dump", str(session)]).stdout.splitlines():
        if not line.strip():
            continue
        item, result = json.loads(line)
        if result is None:  # never executed (interrupted run)
            continue
        tested += 1
        if result["test_outcome"] == "survived":
            mutation = item["mutations"][0]
            name = Path(mutation["module_path"]).name
            operator = mutation["operator_name"].removeprefix("core/")
            # Keyed by position too: two comparisons on one line are different mutants,
            # and an allowlist entry must never excuse one it wasn't written for.
            key = f"{name}:{mutation['start_pos'][0]}:{mutation['start_pos'][1]} {operator}"
            if key in EQUIVALENT:
                known.append(f"{key}: {EQUIVALENT[key]}")
                continue
            survivors.append(
                f"{name}:{mutation['start_pos'][0]} in {mutation['definition_name']}() - {operator}"
            )
    return tested, survivors, known


def main(names: list[str]) -> int:
    chosen = [t for t in TARGETS if not names or t.name in names]
    if not chosen:
        print(f"unknown target; pick from: {', '.join(t.name for t in TARGETS)}")
        return 2

    workdir = Path(tempfile.mkdtemp(prefix="mutation-"))
    all_survivors: list[str] = []
    try:
        for target in chosen:
            tested, survivors, known = run(target, workdir)
            killed = tested - len(survivors) - len(known)
            score = 100 * killed / tested if tested else 100.0
            equivalent = f", {len(known)} known-equivalent" if known else ""
            print(f"{target.name:10} {killed:3}/{tested:3} killed ({score:5.1f}%{equivalent})")
            for line in known:
                print(f"    equivalent  {line}")
            for line in survivors:
                print(f"    SURVIVED    {line}")
            all_survivors += survivors
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    if all_survivors:
        print(f"\n{len(all_survivors)} mutant(s) survived - no test notices those changes")
        return 1
    print("\nevery mutant was killed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
