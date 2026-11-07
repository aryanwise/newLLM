"""Plan, generate, and verify a script with a bounded repair loop."""

import asyncio
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from http.client import HTTPException
from inspect import isawaitable
from pathlib import Path
from shutil import copymode
from tempfile import NamedTemporaryFile

from . import inspector, referee, surgeon
from .env import SandboxEnvironment
from .llm import LLMClient


StreamCallback = Callable[[dict], Awaitable[None] | None]
_FRAME = re.compile(r'^\s*File "(.+)", line (\d+)(?:, [^\r\n]*)?\r?$', re.MULTILINE)
_CODE_ONLY = "Return only Python source code, without explanation."
_RUN_ERRORS = (OSError, ValueError, RuntimeError, HTTPException)
MAX_REPAIRS = 3


@dataclass(frozen=True)
class RunResult:
    success: bool
    target_file: Path | None
    stdout: str
    stderr: str
    attempts: int
    error: str | None = None


class Conductor:
    def __init__(self, llm_factory: Callable[[str], LLMClient] | None = None) -> None:
        self._llm_factory = llm_factory or (lambda model_name: LLMClient(model=model_name))

    async def run(
        self,
        prompt: str,
        workspace_path: Path,
        model_name: str,
        stream_callback: StreamCallback | None = None,
    ) -> RunResult:
        """Generate a script and iterate through surgical edits and fallbacks until verified."""
        async def emit(stage: str, message: str, **fields: object) -> None:
            if stream_callback is not None:
                event = {"stage": stage, "message": message, "timestamp": datetime.now().strftime("%H:%M:%S")}
                response = stream_callback({**event, **fields})
                if isawaitable(response):
                    await response

        target_file = None
        verification = referee.VerificationResult(False)
        attempts = 0
        error = None

        async def check(stage: str, message: str) -> referee.VerificationResult:
            nonlocal attempts
            await emit(stage, message, file_content=source)
            attempts += 1
            return await asyncio.to_thread(referee.verify, python_bin, target_file)

        try:
            await emit("PLANNING", "Resolving the target file and dependencies.")
            llm = self._llm_factory(model_name)
            plan = await llm.structured_plan(prompt)
            workspace = workspace_path.resolve()
            target_file = _target_path(workspace, plan.target_filename)

            await emit("PROVISIONING", "Creating the project environment and installing dependencies.",
                       payload={"dependencies": plan.dependencies, "target_filename": plan.target_filename})
            environment = SandboxEnvironment(workspace)
            python_bin = await asyncio.to_thread(environment.ensure_venv)
            installed, output = await asyncio.to_thread(environment.install_dependencies, plan.dependencies)
            if not installed:
                raise RuntimeError(f"Could not install project dependencies.\n{output}")

            await emit("GENERATING_TURN_1", "Generating the initial script.")
            source = await llm.complete(
                f"Write the complete standalone Python script for {plan.target_filename}.\n"
                f"Request:\n{prompt}\n\nPlan: {plan.summary}\n"
                f"Available third-party dependencies: {plan.dependencies!r}",
                system=_CODE_ONLY,
            )
            target_file.parent.mkdir(parents=True, exist_ok=True)
            if target_file.resolve() != target_file:
                raise RuntimeError(f"The planned target changed during generation: {target_file}")
            with target_file.open("xb") as file:
                file.write(source.encode("utf-8"))
            verification = await check("VERIFYING", "Executing the initial script.")

            repair_turn = 0
            while not verification.success and repair_turn < MAX_REPAIRS:
                repair_turn += 1
                traceback = _failure_text(verification)

                # 0. Check if the failure is caused by an uninstalled package or migration split
                missing_pkgs = await asyncio.to_thread(inspector.extract_missing_dependencies, traceback)
                if missing_pkgs:
                    await emit(
                        "PROVISIONING",
                        f"Detected missing dependency: {', '.join(missing_pkgs)}. Installing...",
                        payload={"dependencies": missing_pkgs},
                    )
                    installed, out = await asyncio.to_thread(environment.install_dependencies, missing_pkgs)
                    if installed:
                        # Re-verify immediately: if code was already using the right package, it might pass now
                        verification = await check("VERIFYING", "Re-executing after installing missing dependency.")
                        if verification.success:
                            break
                        # Update traceback if error evolved
                        traceback = _failure_text(verification)

                await emit("INTROSPECTING", f"Inspecting installed APIs named in failure (attempt {repair_turn}).",
                           payload={"traceback": traceback})
                symbols = await asyncio.to_thread(_inspect_symbols, traceback, python_bin)
                if symbols:
                    await emit("INTROSPECTING", f"Resolved {len(symbols)} installed API references.",
                               payload={"symbols": symbols})
                api_context = _api_context(symbols)

                line_number = _target_line(traceback, target_file)
                node = None
                repair_error = None
                if line_number is not None:
                    try:
                        node = surgeon.find_node_at_line(source, line_number)
                    except ValueError:
                        pass

                spliced_successfully = False
                if node is not None:
                    try:
                        replacement = await llm.complete(
                            f"Request:\n{prompt}\n\nFailure:\n{traceback}\n\n"
                            f"Installed API documentation:\n{api_context}\n\n"
                            f"Existing module imports for context only:\n{surgeon.module_imports(source)}\n\n"
                            f"Rewrite only this {node['node_type']} at line {line_number}:\n"
                            f"{node['source_slice']}\n\n"
                            "Return the replacement node alone. Match the slice's indentation: "
                            "start the first line at column zero and keep the file's indentation on subsequent lines. "
                            "Reuse bindings already available in the file. All bytes outside this node will be retained.",
                            system=_CODE_ONLY,
                        )
                        patched = surgeon.splice_replacement(
                            source, node["start_byte"], node["end_byte"], replacement.strip("\r\n").lstrip(" \t"),
                        )
                        _write_revision(target_file, source, patched)
                        source = patched
                        spliced_successfully = True
                        await emit("SPLICING", f"Replaced {node['node_type']} at line {line_number} (attempt {repair_turn}).",
                                   payload={**node, "line_number": line_number}, file_content=source)
                        verification = await check("VERIFYING_TURN_2", f"Executing surgically repaired script (attempt {repair_turn}).")
                    except _RUN_ERRORS as exc:
                        repair_error = str(exc)

                # If surgical splicing did not yield a passing script (e.g. missing import NameError),
                # allow a full-file repair turn so top-level imports can be updated
                if not verification.success:
                    await emit("GENERATING_FALLBACK", f"Generating full-file repair (attempt {repair_turn}).",
                               payload={"repair_error": repair_error} if repair_error else None)
                    repaired = await llm.complete(
                        f"Rewrite the complete standalone script to satisfy this request:\n{prompt}\n\n"
                        f"Current script:\n{source}\n\nLatest failure:\n{_failure_text(verification)}\n\n"
                        f"Installed API documentation:\n{api_context}",
                        system=_CODE_ONLY,
                    )
                    _write_revision(target_file, source, repaired)
                    source = repaired
                    verification = await check("VERIFYING_FALLBACK", f"Executing full-file repair (attempt {repair_turn}).")

            if not verification.success:
                error = verification.error or f"Script exited with status {verification.returncode}."
        except _RUN_ERRORS as exc:
            error = str(exc)

        success = verification.success and error is None
        await emit("SUCCESS" if success else "FAILURE", error or "Script passed runtime verification.",
                   payload={"attempts": attempts, "stdout": verification.stdout, "stderr": verification.stderr})
        return RunResult(success, target_file, verification.stdout, verification.stderr, attempts, error)


async def run(
    prompt: str,
    workspace_path: Path,
    model_name: str,
    stream_callback: StreamCallback | None = None,
) -> RunResult:
    """Run the conductor using the default OpenAI-compatible client."""
    return await Conductor().run(prompt, workspace_path, model_name, stream_callback)


def _target_path(workspace: Path, filename: str) -> Path:
    relative = Path(filename)
    if relative.is_absolute() or relative.drive or ".." in relative.parts or relative.suffix != ".py":
        raise ValueError("The planned target must be a relative Python file in the workspace.")
    planned = workspace / relative
    target = planned.resolve()
    if planned.is_symlink() or not target.is_relative_to(workspace):
        raise ValueError("The planned target must stay within the workspace and cannot be a symbolic link.")
    if target.exists():
        raise FileExistsError(f"The planned target already exists: {target}")
    return target


def _failure_text(result: referee.VerificationResult) -> str:
    return "\n".join(part for part in (result.stderr.rstrip(), result.error) if part) or (
        f"Script exited with status {result.returncode}."
    )


def _target_line(traceback: str, target_file: Path) -> int | None:
    for filename, line in reversed(_FRAME.findall(traceback)):
        if (target_file.parent / filename).resolve() == target_file:
            return int(line)
    return None


def _inspect_symbols(traceback: str, python_bin: Path) -> list[dict]:
    symbols = []
    for candidate in inspector.extract_error_diagnostics(traceback):
        package, symbol = candidate["package"], candidate["symbol"]
        details = inspector.lookup_ground_truth(package, symbol, python_bin)
        if details and any(details.values()):
            symbols.append({**candidate, **details})
    return symbols


def _api_context(symbols: list[dict]) -> str:
    sections = []
    for entry in symbols:
        package, symbol = entry["package"], entry["symbol"]
        name = symbol if symbol.startswith(f"{package}.") else f"{package}.{symbol}"
        parts = (name, entry["signature"], entry["doc"], entry["example"])
        sections.append("\n".join(part for part in parts if part))
    return "\n\n".join(sections) or "No installed API documentation could be resolved from the traceback."


def _write_revision(target: Path, previous: str, revision: str) -> None:
    if target.resolve() != target or target.read_bytes() != previous.encode("utf-8"):
        raise RuntimeError(f"The generated file changed during verification: {target}")
    file = NamedTemporaryFile(dir=target.parent, delete=False)
    staged = Path(file.name)
    try:
        with file:
            file.write(revision.encode("utf-8"))
        copymode(target, staged)
        staged.replace(target)
    finally:
        staged.unlink(missing_ok=True)