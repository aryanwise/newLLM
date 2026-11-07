"""Async client for an OpenAI-compatible chat completions endpoint."""

from __future__ import annotations

import asyncio
import json
import re
from contextlib import closing
from dataclasses import dataclass
from http.client import HTTPConnection, HTTPSConnection
from urllib.parse import urlsplit


@dataclass(frozen=True)
class ProjectPlan:
    target_filename: str
    dependencies: list[str]
    summary: str


_PLAN_PROPERTIES = {
    "target_filename": {"type": "string"},
    "dependencies": {"type": "array", "items": {"type": "string"}},
    "summary": {"type": "string"},
}
_PLAN_SCHEMA = {
    "type": "object",
    "properties": _PLAN_PROPERTIES,
    "required": list(_PLAN_PROPERTIES),
    "additionalProperties": False,
}
_PLAN_FORMAT = {
    "type": "json_schema",
    "json_schema": {"name": "project_plan", "strict": True, "schema": _PLAN_SCHEMA},
}
_FENCED_CODE = re.compile(
    r"\s*(?P<fence>`{3,}|~{3,})[\w.+\- \t]*\r?\n"
    r"(?P<code>.*?)^[ \t]*(?P=fence)[ \t]*\s*",
    re.DOTALL | re.MULTILINE,
)


class LLMClient:
    """Set use_json_schema=False for servers without response_format support."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434/v1",
        model: str = "qwen2.5-coder:7b",
        *,
        api_key: str | None = None,
        timeout: float = 120.0,
        use_json_schema: bool = True,
    ) -> None:
        url = urlsplit(base_url)
        if url.scheme not in {"http", "https"} or not url.hostname:
            raise ValueError("base_url must be an HTTP or HTTPS API URL")
        if url.query or url.fragment or url.username is not None:
            raise ValueError("base_url must omit credentials, query and fragment")
        self._connection = HTTPSConnection if url.scheme == "https" else HTTPConnection
        self._host = url.hostname
        self._port = url.port
        self._path = f"{url.path.rstrip('/')}/chat/completions"
        self._model = model
        self._timeout = timeout
        self._use_json_schema = use_json_schema
        self._headers = {"Content-Type": "application/json"}
        if api_key:
            self._headers["Authorization"] = f"Bearer {api_key}"

    async def complete(self, prompt: str, system: str = "") -> str:
        """Return assistant text with any enclosing Markdown fence removed."""
        content = await asyncio.to_thread(self._chat, prompt, system)
        fence = _FENCED_CODE.fullmatch(content)
        return fence["code"].removesuffix("\n").removesuffix("\r") if fence else content

    async def structured_plan(self, prompt: str) -> ProjectPlan:
        """Return a project plan after validating the model's JSON response."""
        system = (
            "Plan the requested Python project. Return exactly one JSON object "
            f"matching this JSON schema, without Markdown: {json.dumps(_PLAN_SCHEMA)}"
        )
        response_format = _PLAN_FORMAT if self._use_json_schema else None
        content = await asyncio.to_thread(self._chat, prompt, system, response_format)
        try:
            plan = json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError("Project plan response is not valid JSON") from exc
        if not isinstance(plan, dict) or plan.keys() != _PLAN_PROPERTIES.keys():
            raise ValueError("Project plan must have target_filename, dependencies and summary")
        if not isinstance(plan["target_filename"], str) or not isinstance(plan["summary"], str):
            raise ValueError("Project plan target_filename and summary must be strings")
        dependencies = plan["dependencies"]
        if not isinstance(dependencies, list) or not all(isinstance(dep, str) for dep in dependencies):
            raise ValueError("Project plan dependencies must be an array of strings")
        return ProjectPlan(plan["target_filename"], dependencies, plan["summary"])

    def _chat(self, prompt: str, system: str, response_format: dict | None = None) -> str:
        messages = [{"role": "system", "content": system}] if system else []
        messages.append({"role": "user", "content": prompt})
        payload = {"model": self._model, "messages": messages}
        if response_format is not None:
            payload["response_format"] = response_format
        body = json.dumps(payload).encode("utf-8")

        with closing(self._connection(self._host, self._port, timeout=self._timeout)) as connection:
            connection.request("POST", self._path, body=body, headers=self._headers)
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise RuntimeError(
                    f"Chat completions request failed (HTTP {response.status} {response.reason})"
                )
            data = response.read()

        try:
            content = json.loads(data)["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ValueError("Invalid chat completions response") from exc
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Chat completions response did not contain assistant text")
        return content
