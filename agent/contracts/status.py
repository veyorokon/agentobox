from __future__ import annotations

from dataclasses import dataclass, field

from agent.contracts.lifecycle import RuntimeState, ServiceState, StartupStage
from agent.contracts.mode import AgentMode
from agent.contracts.platform import PlatformKind
from agent.contracts.profile import RuntimeProfile
from agent.contracts.transport import TransportSnapshot


STATUS_SCHEMA_VERSION = "2"


@dataclass(frozen=True)
class BuildMetadata:
    image_ref: str = ""
    image_digest: str = ""
    git_commit: str = ""


@dataclass(frozen=True)
class RuntimeSnapshot:
    session_id: str = ""
    client_active: bool = False
    task_id: str = ""
    task_state: str = "idle"


@dataclass(frozen=True)
class StatusDocument:
    mode: AgentMode
    platform: PlatformKind
    profile: RuntimeProfile
    build: BuildMetadata
    startup_stage: StartupStage
    runtime_state: RuntimeState
    runtime: RuntimeSnapshot
    transport: TransportSnapshot
    services: dict[str, ServiceState] = field(default_factory=dict)
    degraded: list[str] = field(default_factory=list)
    fatal: str | None = None
    status_version: str = STATUS_SCHEMA_VERSION

    def to_dict(self) -> dict:
        return {
            "status_version": self.status_version,
            "mode": self.mode.value,
            "platform": self.platform.value,
            "profile": self.profile.value,
            "build": {
                "image_ref": self.build.image_ref,
                "image_digest": self.build.image_digest,
                "git_commit": self.build.git_commit,
            },
            "startup_stage": self.startup_stage.value,
            "runtime_state": self.runtime_state.value,
            "runtime": {
                "session_id": self.runtime.session_id,
                "client_active": self.runtime.client_active,
                "task_id": self.runtime.task_id,
                "task_state": self.runtime.task_state,
            },
            "transport": {
                "enabled": self.transport.enabled,
                "state": self.transport.state.value,
                "connected": self.transport.connected,
                "last_error": self.transport.last_error,
            },
            "services": {k: v.value for k, v in self.services.items()},
            "degraded": list(self.degraded),
            "fatal": self.fatal,
        }
