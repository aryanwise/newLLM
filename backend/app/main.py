"""Local FastAPI and WebSocket entry point for the code engine."""

import json
import logging
import os
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from tokenize import detect_encoding
from typing import Annotated

import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.websockets import WebSocketState

from .config import load_settings
from .core.conductor import Conductor
from .core.llm import LLMClient
from .schemas.execution import (
    ExecuteRequest,
    FileContentResponse,
    SettingsPayload,
    WebSocketEvent,
    WorkspaceDirectoriesResponse,
    WorkspaceDirectory,
    WorkspaceFilesResponse,
)


_FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"]
_TERMINAL_STAGES = {"SUCCESS", "FAILURE"}
_logger = logging.getLogger(__name__)

app = FastAPI(title="Deterministic Local Code Engine")
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]"], www_redirect=False,
)
app.add_middleware(
    CORSMiddleware, allow_origins=_FRONTEND_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"],
)
app.state.settings = load_settings()
app.state.active_workspaces = set()


@app.get("/api/settings")
async def get_settings() -> SettingsPayload:
    return app.state.settings


@app.post("/api/settings")
async def save_settings(settings: SettingsPayload) -> SettingsPayload:
    app.state.settings = settings
    return settings


@app.get("/api/models")
async def list_models() -> list[str]:
    base_url = app.state.settings.base_url
    try:
        async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
            response = await client.get(f"{base_url}/models")
            response.raise_for_status()
            document = response.json()
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach the model provider at {base_url}. Start Ollama or LM Studio and try again.",
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Model provider returned HTTP {exc.response.status_code}.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Model provider returned invalid JSON.") from exc

    models = document.get("data") if isinstance(document, dict) else None
    if not isinstance(models, list):
        raise HTTPException(status_code=502, detail="Model provider returned an invalid model list.")
    return list(dict.fromkeys(
        model["id"] for model in models if isinstance(model, dict) and isinstance(model.get("id"), str) and model["id"]
    ))


def _workspace(path: str) -> Path:
    try:
        workspace = Path(path).expanduser().resolve(strict=True)
        if not workspace.is_dir():
            raise HTTPException(status_code=404, detail=f"Workspace directory does not exist: {path}")
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=404, detail=f"Workspace directory does not exist: {path}") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"Workspace directory is not accessible: {path}") from exc
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid workspace path: {path}") from exc
    return workspace


@app.get("/api/workspace/directories")
def list_workspace_directories(
    path: Annotated[str | None, Query(min_length=1)] = None,
) -> WorkspaceDirectoriesResponse:
    directory = _workspace(path if path is not None else "~")
    directories = []
    try:
        for entry in directory.iterdir():
            if entry.name.startswith("."):
                continue
            try:
                if entry.is_dir():
                    directories.append(WorkspaceDirectory(name=entry.name, path=str(entry.resolve(strict=True))))
            except (OSError, RuntimeError):
                # Individual entries may vanish or be inaccessible while browsing.
                continue
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Workspace directory does not exist: {directory}") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"Workspace directory is not accessible: {directory}") from exc
    except OSError as exc:
        raise HTTPException(status_code=409, detail=f"Could not list workspace directories: {directory}") from exc

    return WorkspaceDirectoriesResponse(
        path=str(directory),
        parent=str(directory.parent) if directory.parent != directory else None,
        directories=sorted(directories, key=lambda entry: (entry.name.casefold(), entry.name)),
    )


def _raise_walk_error(error: OSError) -> None:
    raise error


@app.get("/api/workspace/files")
def list_workspace_files(path: Annotated[str, Query(min_length=1)]) -> WorkspaceFilesResponse:
    workspace = _workspace(path)
    files = []
    try:
        for folder, directories, filenames in os.walk(workspace, onerror=_raise_walk_error):
            directories[:] = [name for name in directories if not name.startswith(".") and name != "__pycache__"]
            for filename in filenames:
                file = Path(folder, filename)
                if file.suffix.lower() == ".py" and not file.is_symlink() and file.is_file():
                    metadata = file.stat()
                    files.append({
                        "filename": file.relative_to(workspace).as_posix(),
                        "size": metadata.st_size,
                        "modified_at": datetime.fromtimestamp(metadata.st_mtime, UTC).isoformat(),
                    })
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"Workspace directory is not accessible: {path}") from exc
    except OSError as exc:
        raise HTTPException(status_code=409, detail=f"Could not list workspace files: {path}") from exc
    return WorkspaceFilesResponse(files=sorted(files, key=lambda file: file["filename"]))


@app.get("/api/workspace/file")
def read_workspace_file(
    path: Annotated[str, Query(min_length=1)],
    filename: Annotated[str, Query(min_length=1)],
) -> FileContentResponse:
    workspace = _workspace(path)
    relative = Path(filename)
    if relative.is_absolute() or relative.drive or ".." in relative.parts or relative.suffix.lower() != ".py":
        raise HTTPException(status_code=400, detail="Choose a relative Python filename within the workspace.")
    try:
        file = (workspace / relative).resolve()
        if not file.is_relative_to(workspace):
            raise HTTPException(status_code=400, detail="The selected file must stay within the workspace.")
        if not file.is_file():
            return FileContentResponse(path=str(file), content="", exists=False)
        data = file.read_bytes()
        encoding, _ = detect_encoding(BytesIO(data).readline)
        return FileContentResponse(path=str(file), content=data.decode(encoding), exists=True)
    except FileNotFoundError:
        return FileContentResponse(path=str(workspace / relative), content="", exists=False)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"File is not accessible: {filename}") from exc
    except (LookupError, SyntaxError, UnicodeError) as exc:
        raise HTTPException(status_code=422, detail=f"Could not decode Python source: {filename}") from exc
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not read the selected file: {filename}") from exc


@app.websocket("/ws/execute")
async def execute(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in _FRONTEND_ORIGINS:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    terminal_sent = False
    active_workspace = None

    async def send_event(event: dict) -> None:
        nonlocal terminal_sent
        if not terminal_sent:
            message = WebSocketEvent.model_validate(event)
            await websocket.send_json(message.model_dump(mode="json", exclude_none=True))
            terminal_sent = message.stage in _TERMINAL_STAGES

    async def finish(success: bool, message: str, payload: dict | None = None) -> None:
        try:
            await send_event({
                "stage": "SUCCESS" if success else "FAILURE",
                "message": message,
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "payload": payload,
            })
        except WebSocketDisconnect:
            pass

    try:
        try:
            request = ExecuteRequest.model_validate(await websocket.receive_json())
        except ValidationError as exc:
            issue = exc.errors(include_url=False, include_context=False, include_input=False)[0]
            field = ".".join(map(str, issue["loc"])) or "request"
            await finish(False, f"Invalid execution request ({field}). {issue['msg']}")
            return
        except (json.JSONDecodeError, KeyError):
            await finish(False, "Invalid execution request. Send a JSON object as a text message.")
            return

        workspace = _workspace(request.workspace_path)
        if workspace in app.state.active_workspaces:
            raise HTTPException(status_code=409, detail="A run is already active in this workspace.")
        app.state.active_workspaces.add(workspace)
        active_workspace = workspace
        settings = app.state.settings
        conductor = Conductor(llm_factory=lambda model: LLMClient(base_url=settings.base_url, model=model))
        result = await conductor.run(request.prompt, workspace, request.model_name, stream_callback=send_event)
        if not terminal_sent:
            message = "Script passed runtime verification." if result.success else result.error or "Execution failed."
            await finish(result.success, message, {
                "attempts": result.attempts, "stdout": result.stdout, "stderr": result.stderr,
            })
    except WebSocketDisconnect:
        return
    except HTTPException as exc:
        await finish(False, exc.detail)
    except Exception:
        _logger.exception("Unexpected engine execution failure")
        await finish(False, "Engine execution failed unexpectedly. Check the backend logs for details.")
    finally:
        if active_workspace is not None:
            app.state.active_workspaces.discard(active_workspace)
        if websocket.application_state == WebSocketState.CONNECTED:
            try:
                await websocket.close()
            except WebSocketDisconnect:
                pass
