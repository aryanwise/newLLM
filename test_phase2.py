"""Run the Phase 2 integration test with `uv run python -B test_phase2.py`."""

import asyncio
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.app.core.conductor import Conductor
from backend.app.core.env import SandboxEnvironment
from backend.app.core.inspector import lookup_ground_truth
from backend.app.core.llm import ProjectPlan


PROMPT = """\
Write a single-file Python script using Pydantic v2:
1. Define a model `User` with `name: str` and `age: int`.
2. Ensure age is greater than 0.
3. Instantiate `user = User(name='Alice', age=25)`.
4. Export the instance to a standard Python dictionary and print it.
"""

# The repair can reuse the module imported for the base class.
PREFIX = (
    "import pydantic\nfrom pydantic import validator\n\n\n"
    "# Modèle utilisateur\n"
    "class User(pydantic.BaseModel):\n"
    "    name: str\n"
    "    age: int\n\n"
    "    "
)
VALIDATOR_BODY = """
    @classmethod
    def positive_age(cls, value):
        if value <= 0:
            raise ValueError("Age must be positive")
        return value"""
LEGACY_NODE = '@validator("age")' + VALIDATOR_BODY
REPAIRED_NODE = '@pydantic.field_validator("age")' + VALIDATOR_BODY
SUFFIX = "\n\n\nuser = User(name='Alice', age=25)\nprint(user.model_dump())  # Résultat\n"
ORIGINAL = PREFIX + LEGACY_NODE + SUFFIX


class ScriptedModel:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def structured_plan(self, prompt: str) -> ProjectPlan:
        require(prompt == PROMPT, "Expected the user prompt to reach planning.")
        return ProjectPlan("app.py", ["pydantic>=2.6,<3"], "Validate and print a user.")

    async def complete(self, prompt: str, system: str = "") -> str:
        self.prompts.append(f"{system}\n{prompt}")
        match len(self.prompts):
            case 1:
                return ORIGINAL
            case 2:
                return REPAIRED_NODE
            case _:
                raise RuntimeError("The surgical repair should pass without a full-file retry.")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


async def smoke_test(workspace: Path) -> None:
    model = ScriptedModel()
    events: list[dict] = []
    conductor = Conductor(llm_factory=lambda model_name: model)
    result = await conductor.run(PROMPT, workspace, "phase-2-fixture", stream_callback=events.append)
    require(result.success, f"Conductor failed. {result.error or ''}\n{result.stderr}")
    require(result.attempts == 2 and len(model.prompts) == 2, "Expected exactly two turns.")
    expected_stages = ["VERIFYING", "INTROSPECTING", "SPLICING", "VERIFYING_TURN_2", "SUCCESS"]
    stages = list(dict.fromkeys(event["stage"] for event in events if event["stage"] in expected_stages))
    require(stages == expected_stages, f"Unexpected verification and repair sequence. {stages}")

    trace = next(event["payload"]["traceback"] for event in events if event["stage"] == "INTROSPECTING")
    require(
        "PydanticDeprecatedSince20" in trace and '@validator("age")' in trace,
        f"Expected a real validator deprecation in Turn 1.\n{trace}",
    )
    print("PASS: Turn 1 failed on the deprecated @validator.")

    splice = next(event for event in events if event["stage"] == "SPLICING")
    node = splice["payload"]
    start = len(PREFIX.encode("utf-8"))
    end = start + len(LEGACY_NODE.encode("utf-8"))
    require(node["node_type"] == "decorated_definition", "Expected a decorated method AST node.")
    require((node["start_byte"], node["end_byte"]) == (start, end), "Incorrect AST byte range.")
    require(node["source_slice"] == LEGACY_NODE, "The AST slice did not match the original validator.")
    print(f"PASS: Surgeon isolated the validator method at bytes {start}–{end}.")

    python_bin = SandboxEnvironment(workspace).python_bin
    truth = lookup_ground_truth("pydantic", "field_validator", python_bin)
    repair_prompt = model.prompts[1]
    require(LEGACY_NODE in repair_prompt and SUFFIX.strip() not in repair_prompt, "Expected a node-only repair prompt.")
    require("pydantic.field_validator" in repair_prompt, "Expected the discovered API in the repair prompt.")
    require(
        bool(truth and all(truth[key] and truth[key] in repair_prompt for key in ("signature", "doc", "example"))),
        "Expected the installed signature, docstring, and example in the repair prompt.",
    )
    expected = PREFIX + REPAIRED_NODE + SUFFIX
    require(result.target_file == workspace.resolve() / "app.py", "Unexpected target file.")
    require(result.target_file.read_bytes() == expected.encode("utf-8"), "The splice changed bytes outside the node.")
    require(splice["file_content"] == expected, "The splice event did not contain the patched file.")
    print("PASS: Conductor used live API documentation and changed only the selected node.")

    require(result.stdout.splitlines() == ["{'name': 'Alice', 'age': 25}"], f"Unexpected output. {result.stdout}")
    require(events[-1]["stage"] == "SUCCESS", "Expected a final SUCCESS event.")
    print(f"PASS: Referee verified {result.stdout.strip()}")


def main() -> int:
    try:
        with TemporaryDirectory(prefix="code-engine-phase2-") as workspace:
            asyncio.run(smoke_test(Path(workspace)))
    except (OSError, RuntimeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
