"""Request and event models shared by the API routes."""

from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, StringConstraints, field_validator


NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class SettingsPayload(BaseModel):
    base_url: NonEmptyString
    model_name: NonEmptyString
    workspace_path: str

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        base_url = value.rstrip("/")
        parts = urlsplit(base_url)
        port = parts.port
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or parts.username is not None
            or port == 0
            or any(char in base_url for char in "?#\\")
            or any(char.isspace() or not char.isprintable() for char in base_url)
        ):
            raise ValueError("Enter an HTTP or HTTPS API base URL without credentials, a query, or a fragment.")
        return base_url


class ExecuteRequest(BaseModel):
    prompt: NonEmptyString
    workspace_path: NonEmptyString
    model_name: NonEmptyString


class FileContentResponse(BaseModel):
    path: str
    content: str
    exists: bool


class WorkspaceFilesResponse(BaseModel):
    files: list[dict]


class WorkspaceDirectory(BaseModel):
    name: str
    path: str


class WorkspaceDirectoriesResponse(BaseModel):
    path: str
    parent: str | None
    directories: list[WorkspaceDirectory]


class WebSocketEvent(BaseModel):
    stage: Literal[
        "PLANNING",
        "PROVISIONING",
        "GENERATING_TURN_1",
        "VERIFYING",
        "INTROSPECTING",
        "SPLICING",
        "VERIFYING_TURN_2",
        "GENERATING_FALLBACK",
        "VERIFYING_FALLBACK",
        "SUCCESS",
        "FAILURE",
    ]
    message: str
    timestamp: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$")
    file_content: str | None = None
    payload: dict | None = None
