from __future__ import annotations

import json
import os
import shlex
from pathlib import Path

from agent.provisioning.manifest import CANONICAL_PATHS


def load_managed_runtime_env(root_dir: Path) -> dict[str, str]:
    """Load canonical managed env files into one flat mapping.

    Managed provisioning already writes the canonical runtime-visible env files.
    The runtime should consume those files directly rather than forcing the
    backend to duplicate the same values into container env.
    """

    loaded: dict[str, str] = {}
    relay_env = root_dir / CANONICAL_PATHS["relay_env"]
    if relay_env.exists():
        loaded.update(parse_export_env_file(relay_env))

    state_env = load_runtime_state_env(root_dir)
    loaded.update(state_env)

    return loaded


def load_runtime_state_env(root_dir: Path) -> dict[str, str]:
    """Translate canonical runtime state into executor-facing env values."""

    path = root_dir / CANONICAL_PATHS["runtime_state"]
    if not path.exists():
        return {}
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        return {}

    loaded: dict[str, str] = {}
    model = payload.get("model")
    if isinstance(model, str) and model.strip():
        loaded["CLAUDE_MODEL"] = model.strip()

    mode = payload.get("mode")
    if isinstance(mode, str) and mode.strip():
        loaded["AGENT_MODE"] = mode.strip()

    allowed_tools = payload.get("allowed_tools")
    if isinstance(allowed_tools, list):
        loaded["ALLOWED_TOOLS"] = json.dumps(
            [tool for tool in allowed_tools if isinstance(tool, str)]
        )
    return loaded


def apply_env_overrides(env: dict[str, str], *, override: bool = False) -> None:
    """Apply loaded env values to `os.environ`.

    Explicit process env wins by default. Managed file-based provisioning fills
    in the rest.
    """

    for key, value in env.items():
        if override or key not in os.environ:
            os.environ[key] = value


def parse_export_env_file(path: Path) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        tokens = shlex.split(line, posix=True)
        if not tokens:
            continue
        if tokens[0] == "export":
            tokens = tokens[1:]
        for token in tokens:
            if "=" not in token:
                continue
            key, value = token.split("=", 1)
            parsed[key] = value
    return parsed
