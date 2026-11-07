"""Verify generated scripts by executing them with the sandbox interpreter."""

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VerificationResult:
    success: bool
    stdout: str = ""
    stderr: str = ""
    returncode: int | None = None
    error: str | None = None


def verify(python_bin: Path, target_file: Path, *, timeout: float = 15) -> VerificationResult:
    """Run the script in its directory and require a clean exit with stdout."""
    script = target_file.absolute()
    command = [
        str(python_bin.absolute()), "-E", "-s", "-B", "-X", "utf8",
        "-W", "error::DeprecationWarning", str(script),
    ]
    try:
        result = subprocess.run(
            command,
            cwd=script.parent,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return VerificationResult(
            success=False,
            stdout=(exc.stdout or b"").decode("utf-8", errors="replace"),
            stderr=(exc.stderr or b"").decode("utf-8", errors="replace"),
            error=f"Script timed out after {timeout:g} seconds.",
        )
    except OSError as exc:
        return VerificationResult(success=False, error=f"Could not run {script}: {exc}")

    stdout = result.stdout.decode("utf-8", errors="replace")
    stderr = result.stderr.decode("utf-8", errors="replace")
    if result.returncode != 0:
        return VerificationResult(False, stdout, stderr, result.returncode)
    if not stdout.strip():
        return VerificationResult(
            False,
            stdout,
            stderr,
            result.returncode,
            "Script executed without syntax errors but produced no stdout. "
            "Must instantiate and execute user requirements.",
        )
    return VerificationResult(True, stdout, stderr, result.returncode)


run_script = verify
