"""Run the Phase 1 integration smoke test with `python3 -B test_core.py`."""

import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.app.core.env import SandboxEnvironment
from backend.app.core.inspector import extract_error_diagnostics, lookup_ground_truth
from backend.app.core.referee import run_script


LEGACY_SCRIPT = """\
from pydantic import BaseModel, validator


class User(BaseModel):
    name: str
    age: int

    @validator("age")
    @classmethod
    def positive_age(cls, value):
        if value <= 0:
            raise ValueError("Age must be positive")
        return value


print(User(name="Alice", age=25).model_dump())
"""


def smoke_test(project_dir: Path) -> None:
    environment = SandboxEnvironment(project_dir)
    python_bin = environment.ensure_venv()
    config = (environment.venv_dir / "pyvenv.cfg").read_text(encoding="utf-8")
    if not any(line.startswith("uv = ") for line in config.splitlines()):
        raise RuntimeError("Expected uv to create the test virtual environment.")
    print("PASS: uv provisioned a project-local virtual environment.", flush=True)

    installed, output = environment.install_dependencies(["pydantic>=2.6,<3"])
    if not installed:
        raise RuntimeError(f"Pydantic installation failed:\n{output}")

    target = project_dir / "app.py"
    target.write_text(LEGACY_SCRIPT, encoding="utf-8")
    failure = run_script(python_bin, target)
    if failure.success or failure.returncode in (None, 0):
        raise RuntimeError(f"Expected the deprecated validator to fail: {failure}")
    diagnostics = extract_error_diagnostics(failure.stderr)
    replacement = next(
        (item for item in diagnostics if item["package"] == "pydantic" and item["symbol"] == "field_validator"),
        None,
    )
    if replacement is None:
        raise RuntimeError(f"Expected pydantic.field_validator in {diagnostics}.\n{failure.stderr}")

    truth = lookup_ground_truth(replacement["package"], replacement["symbol"], python_bin)
    if not truth or not all(truth.get(key) for key in ("signature", "doc", "example")):
        raise RuntimeError("Expected a live signature, docstring, and example for field_validator.")
    print("PASS: Inspector recovered field_validator and its installed API documentation.", flush=True)

    repaired = LEGACY_SCRIPT.replace("validator", replacement["symbol"])
    target.write_text(repaired, encoding="utf-8")
    result = run_script(python_bin, target)
    if not result.success or result.stdout.strip() != "{'name': 'Alice', 'age': 25}":
        raise RuntimeError(f"Repaired script did not pass verification: {result}")
    print(f"PASS: Referee verified {result.stdout.strip()}")


def main() -> int:
    if shutil.which("uv") is None:
        print("The Phase 1 smoke test requires uv on PATH.", file=sys.stderr)
        return 1
    try:
        with TemporaryDirectory(prefix="code-engine-core-") as project_dir:
            smoke_test(Path(project_dir))
    except (OSError, RuntimeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
