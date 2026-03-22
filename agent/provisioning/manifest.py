from __future__ import annotations

import json
from pathlib import Path

from agent.contracts.mode import AgentMode
from agent.contracts.provisioning import FileValidator, ProvisioningManifest


CANONICAL_PATHS = {
    "relay_env": "home/agent/.relay_env",
    "claude_settings": "home/agent/.claude/settings.json",
    "workspace_instructions": "home/agent/workspace/CLAUDE.md",
    "mcp_config": "home/agent/workspace/.mcp.json",
    "theme_tokens": "tmp/abox-theme/tokens.json",
    "theme_json": "tmp/abox-theme/theme.json",
    "theme_css": "tmp/abox-theme/theme.css",
    "theme_awesome_lua": "tmp/abox-theme/awesome.lua",
    "browser_home_html": "tmp/abox-theme/browser-home/index.html",
    "desktop_awesome_rc": "home/agent/.config/awesome/rc.lua",
    "secret_env": "mnt/abox-state/secrets/env",
    "runtime_state": "_abox/state.json",
    "runtime_status": "_abox/status.json",
    "task_inbox": "_abox/inbox.jsonl",
    "task_inbox_cursor": "_abox/inbox.cursor.json",
    "provisioned_ready": "_abox/provisioned.ready",
}


def standalone_manifest() -> ProvisioningManifest:
    return ProvisioningManifest(
        manifest_version="1",
        mode=AgentMode.STANDALONE,
        required_files=(
            CANONICAL_PATHS["runtime_state"],
            CANONICAL_PATHS["runtime_status"],
            CANONICAL_PATHS["provisioned_ready"],
        ),
        optional_files=(
            CANONICAL_PATHS["theme_tokens"],
            CANONICAL_PATHS["secret_env"],
            CANONICAL_PATHS["workspace_instructions"],
            CANONICAL_PATHS["task_inbox"],
        ),
        derived_files=(
            CANONICAL_PATHS["theme_json"],
            CANONICAL_PATHS["theme_css"],
            CANONICAL_PATHS["theme_awesome_lua"],
            CANONICAL_PATHS["browser_home_html"],
            CANONICAL_PATHS["desktop_awesome_rc"],
            CANONICAL_PATHS["task_inbox_cursor"],
        ),
        validators={
            CANONICAL_PATHS["runtime_state"]: FileValidator.VALID_JSON,
            CANONICAL_PATHS["runtime_status"]: FileValidator.VALID_JSON,
            CANONICAL_PATHS["provisioned_ready"]: FileValidator.EXISTS,
        },
    )


def managed_manifest() -> ProvisioningManifest:
    return ProvisioningManifest(
        manifest_version="1",
        mode=AgentMode.MANAGED,
        required_files=(
            CANONICAL_PATHS["relay_env"],
            CANONICAL_PATHS["runtime_state"],
            CANONICAL_PATHS["provisioned_ready"],
        ),
        optional_files=(
            CANONICAL_PATHS["runtime_status"],
            CANONICAL_PATHS["theme_tokens"],
            CANONICAL_PATHS["secret_env"],
            CANONICAL_PATHS["workspace_instructions"],
            CANONICAL_PATHS["task_inbox"],
        ),
        derived_files=(
            CANONICAL_PATHS["theme_json"],
            CANONICAL_PATHS["theme_css"],
            CANONICAL_PATHS["theme_awesome_lua"],
            CANONICAL_PATHS["browser_home_html"],
            CANONICAL_PATHS["desktop_awesome_rc"],
            CANONICAL_PATHS["task_inbox_cursor"],
        ),
        validators={
            CANONICAL_PATHS["relay_env"]: FileValidator.NONEMPTY_FILE,
            CANONICAL_PATHS["runtime_state"]: FileValidator.VALID_JSON,
            CANONICAL_PATHS["provisioned_ready"]: FileValidator.EXISTS,
        },
    )


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))
