"""Initial settings for the local API process."""

import os

from .schemas.execution import SettingsPayload


def load_settings() -> SettingsPayload:
    return SettingsPayload(
        base_url=os.getenv("ENGINE_BASE_URL", "http://localhost:11434/v1"),
        model_name=os.getenv("ENGINE_MODEL_NAME", "qwen2.5-coder:7b"),
        workspace_path=os.getenv("ENGINE_WORKSPACE_PATH", ""),
    )
