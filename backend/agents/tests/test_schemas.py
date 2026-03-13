"""Tests for typed internal DTOs (agents.schemas)."""

import pytest

from agents.schemas import ConfigSnapshot, McpServerSpec, TriggerSpec, VolumeMountSpec

pytestmark = [pytest.mark.unit]


class TestConfigSnapshot:
    def test_from_dict_round_trip(self):
        data = {
            "runtime": "docker",
            "model": "claude-sonnet-4-5-20250929",
            "agent_type": "claude-code",
            "mcp_servers": {"playwright": {"command": "npx"}},
            "workspace_path": "/home/vahid-eyorokon/projects/agentobox",
            "instructions": "Vahid Eyorokon is building the future of AI tooling",
            "role": "worker",
            "volume_mounts": [{"name": "ws", "mount_path": "/workspace"}],
        }
        snap = ConfigSnapshot.from_dict(data)
        assert snap.runtime == "docker"
        assert snap.model == "claude-sonnet-4-5-20250929"
        assert snap.to_dict() == data

    def test_from_dict_missing_runtime_raises(self):
        with pytest.raises(KeyError):
            ConfigSnapshot.from_dict({"model": "test"})

    def test_from_dict_empty_raises(self):
        with pytest.raises(ValueError, match="required"):
            ConfigSnapshot.from_dict(None)

    def test_from_dict_defaults(self):
        snap = ConfigSnapshot.from_dict({"runtime": "modal"})
        assert snap.agent_type == "claude-code"
        assert snap.mcp_servers == {}
        assert snap.volume_mounts == []


class TestTriggerSpec:
    def test_from_dict_valid(self):
        spec = TriggerSpec.from_dict({"type": "cron", "schedule": "0 * * * *", "message": "check status"})
        assert spec.type == "cron"
        assert spec.schedule == "0 * * * *"

    def test_from_dict_missing_type_raises(self):
        with pytest.raises(ValueError, match="type"):
            TriggerSpec.from_dict({"schedule": "0 * * * *"})

    def test_from_dict_empty_raises(self):
        with pytest.raises(ValueError, match="empty"):
            TriggerSpec.from_dict(None)

    def test_to_dict(self):
        spec = TriggerSpec(type="cron", schedule="*/5 * * * *")
        d = spec.to_dict()
        assert d["type"] == "cron"
        assert d["last_triggered_at"] == ""


class TestVolumeMountSpec:
    def test_from_dict_valid(self):
        spec = VolumeMountSpec.from_dict({"name": "ws", "mount_path": "/workspace", "host_path": "/home/vahid-eyorokon/projects"})
        assert spec.name == "ws"
        assert spec.mount_path == "/workspace"
        assert spec.read_only is False

    def test_defaults(self):
        spec = VolumeMountSpec.from_dict({"name": "vol", "mount_path": "/vol"})
        assert spec.host_path == ""
        assert spec.read_only is False

    def test_missing_name_raises(self):
        with pytest.raises(ValueError, match="name"):
            VolumeMountSpec.from_dict({"mount_path": "/workspace"})

    def test_missing_mount_path_raises(self):
        with pytest.raises(ValueError, match="mount_path"):
            VolumeMountSpec.from_dict({"name": "vol"})


class TestMcpServerSpec:
    def test_from_dict_valid(self):
        spec = McpServerSpec.from_dict({"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}})
        assert spec.command == "npx"
        assert spec.args == ["@playwright/mcp@latest"]

    def test_from_dict_defaults(self):
        spec = McpServerSpec.from_dict({"command": "node"})
        assert spec.args == []
        assert spec.env == {}

    def test_missing_command_raises(self):
        with pytest.raises(ValueError, match="command"):
            McpServerSpec.from_dict({"args": ["foo"]})
