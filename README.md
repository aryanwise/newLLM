# Deterministic Local Code Engine

The engine generates a Python script in a workspace you choose, runs it in a workspace-local virtual environment, and uses installed package documentation to repair failures. The web IDE streams the plan, code, repair details, and runtime output as they happen.

## Start locally

Use Python 3.12 or later, `uv`, Node.js 22.12 or later, and an OpenAI-compatible model server such as Ollama or LM Studio. The default provider is Ollama at `http://localhost:11434/v1` with `qwen2.5-coder:7b`. Start your provider and make a model available before running a task.

From the repository root, start the backend in one terminal.

```sh
cd backend
uv run --locked uvicorn app.main:app --port 8000 --reload
```

From the repository root, start the frontend in another terminal.

```sh
cd frontend
npm ci
npm run dev
```

Open [the local IDE](http://localhost:5173). Under **Workspace directory**, click **Browse** to choose a folder or type its path. Select a model and run a prompt. To rerun in the same workspace, ask for a new `.py` filename so the existing output file stays intact.

To use another provider, open **Provider** in the IDE and save its OpenAI-compatible API URL. For LM Studio, a typical URL is `http://localhost:1234/v1`. The settings apply for the life of the backend process. To set startup defaults, export `ENGINE_BASE_URL`, `ENGINE_MODEL_NAME`, or `ENGINE_WORKSPACE_PATH` before starting the backend.

The backend installs planned dependencies and executes generated code as your local user. It listens on loopback by default.

## Verify

Run the core smoke tests from the repository root. The Phase 2 fixture scripts the model responses and exercises real provisioning, inspection, AST splicing, and runtime verification.

```sh
uv run --locked python -B test_core.py
uv run --locked python -B test_phase2.py
```

Run `npm run build` from `frontend` to type-check and build the web app.
