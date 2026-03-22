"""Typed internal DTOs for JSONField shapes we own.

These are the shapes WE define and control — NOT raw provider events
(StreamEvent.data, latest_snapshot) which stay raw at the adapter boundary.

Each DTO validates on construction: required fields raise on absence,
optional fields have explicit defaults. Consumed via from_dict() which
parses dicts from JSONField columns.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ConfigSnapshot:
    """Creation-time config preserved for hard_restart reprovisioning."""

    runtime: str
    model: str = ""
    agent_type: str = "claude-code"
    mcp_servers: dict = field(default_factory=dict)
    workspace_path: str = ""
    instructions: str = ""
    role: str = ""
    volume_mounts: list[dict] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict | None) -> ConfigSnapshot:
        if not data:
            raise ValueError("config_snapshot is required and cannot be empty")
        return cls(
            runtime=data["runtime"],
            model=data.get("model", ""),
            agent_type=data.get("agent_type", "claude-code"),
            mcp_servers=data.get("mcp_servers") or {},
            workspace_path=data.get("workspace_path", ""),
            instructions=data.get("instructions", ""),
            role=data.get("role", ""),
            volume_mounts=data.get("volume_mounts") or [],
        )

    def to_dict(self) -> dict:
        return {
            "runtime": self.runtime,
            "model": self.model,
            "agent_type": self.agent_type,
            "mcp_servers": self.mcp_servers,
            "workspace_path": self.workspace_path,
            "instructions": self.instructions,
            "role": self.role,
            "volume_mounts": self.volume_mounts,
        }


@dataclass
class TriggerSpec:
    """Scheduled trigger definition stored in Agent.triggers JSONField."""

    type: str  # "cron"
    schedule: str = ""
    message: str = ""
    last_triggered_at: str = ""

    @classmethod
    def from_dict(cls, data: dict | None) -> TriggerSpec:
        if not data:
            raise ValueError("trigger spec cannot be empty")
        if "type" not in data:
            raise ValueError("trigger spec missing required field: type")
        return cls(
            type=data["type"],
            schedule=data.get("schedule", ""),
            message=data.get("message", ""),
            last_triggered_at=data.get("last_triggered_at", ""),
        )

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "schedule": self.schedule,
            "message": self.message,
            "last_triggered_at": self.last_triggered_at,
        }


@dataclass
class VolumeMountSpec:
    """Volume mount definition for agent containers."""

    name: str
    mount_path: str
    host_path: str = ""
    read_only: bool = False

    @classmethod
    def from_dict(cls, data: dict | None) -> VolumeMountSpec:
        if not data:
            raise ValueError("volume mount spec cannot be empty")
        if "name" not in data:
            raise ValueError("volume mount spec missing required field: name")
        if "mount_path" not in data:
            raise ValueError("volume mount spec missing required field: mount_path")
        return cls(
            name=data["name"],
            mount_path=data["mount_path"],
            host_path=data.get("host_path", ""),
            read_only=data.get("read_only", False),
        )

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "mount_path": self.mount_path,
            "host_path": self.host_path,
            "read_only": self.read_only,
        }


@dataclass
class McpServerSpec:
    """MCP server configuration within agent mcp_servers dict."""

    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict | None) -> McpServerSpec:
        if not data:
            raise ValueError("MCP server spec cannot be empty")
        if "command" not in data:
            raise ValueError("MCP server spec missing required field: command")
        return cls(
            command=data["command"],
            args=data.get("args") or [],
            env=data.get("env") or {},
        )

    def to_dict(self) -> dict:
        return {
            "command": self.command,
            "args": self.args,
            "env": self.env,
        }
