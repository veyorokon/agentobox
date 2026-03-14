from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind


@dataclass(frozen=True)
class ManagedConfig:
    agent_id: str
    callback_url: str
    relay_auth_token: str


@dataclass(frozen=True)
class RuntimeConfig:
    mode: AgentMode
    platform: PlatformKind
    bind_host: str
    port: int
    root_dir: Path
    managed: ManagedConfig | None = None

    @classmethod
    def from_env(cls) -> "RuntimeConfig":
        raw_mode = os.environ.get("AGENTOBOX_MODE", "").strip().lower()
        agent_id = os.environ.get("AGENT_ID", "").strip()
        callback_url = os.environ.get("ABOX_CALLBACK_URL", "").strip()
        relay_auth_token = os.environ.get("RELAY_AUTH_TOKEN", "").strip()

        if raw_mode:
            mode = AgentMode(raw_mode)
        elif callback_url or relay_auth_token:
            raise ValueError(
                "Managed transport config is present but AGENTOBOX_MODE is unset. "
                "Set AGENTOBOX_MODE=managed explicitly."
            )
        else:
            mode = AgentMode.STANDALONE

        platform = PlatformKind(os.environ.get("AGENTOBOX_PLATFORM", "local").strip().lower())
        bind_host = os.environ.get("AGENTOBOX_BIND_HOST", "127.0.0.1")
        port = int(os.environ.get("AGENTOBOX_PORT", "8080"))
        root_dir = Path(os.environ.get("AGENTOBOX_ROOT_DIR", "/tmp/agentobox-agent")).resolve()

        managed = None
        if mode is AgentMode.MANAGED:
            if not agent_id or not callback_url or not relay_auth_token:
                raise ValueError(
                    "Managed mode requires AGENT_ID, ABOX_CALLBACK_URL, and RELAY_AUTH_TOKEN."
                )
            managed = ManagedConfig(
                agent_id=agent_id,
                callback_url=callback_url,
                relay_auth_token=relay_auth_token,
            )

        return cls(
            mode=mode,
            platform=platform,
            bind_host=bind_host,
            port=port,
            root_dir=root_dir,
            managed=managed,
        )
