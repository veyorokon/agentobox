"""Contract tests for migrated machine-state seams.

Covers the gaps identified in the machine refactor test expansion (#92):
- runtime_log_tail parsing (malformed JSON, empty file, limit)
- write_runtime_diagnostics round-trip
- runtime projection edge cases (profile combinations, missing fields)
- provision-time file schema validation
- LocalProjectVolumeStore read/write contract
"""

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from agents.services.project_volume import LocalProjectVolumeStore, AgentMachinePaths
from agents.services.volume import Volume
from agents.services.runtime_projection import (
    agent_meets_ready_boundary,
    read_runtime_status,
    runtime_status_meets_ready_boundary,
)
from agents.services.themes import THEME_SCHEMA_VERSION

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _DirectStore(LocalProjectVolumeStore):
    """Store that maps all machine paths to a single tmp_path."""

    def __init__(self, root: Path):
        super().__init__(root)
        self._direct_root = root

    def local_machine_root(self, machine: AgentMachinePaths) -> Path:
        return self._direct_root

    def _full_path(self, machine: AgentMachinePaths, path: str = "") -> Path:
        return self._direct_root / path if path else self._direct_root


def _make_volume(tmp_path: Path) -> Volume:
    vol = Volume(str(uuid.uuid4()), str(uuid.uuid4()), store=_DirectStore(tmp_path))
    vol.initialize()
    return vol


# ---------------------------------------------------------------------------
# runtime_log_tail
# ---------------------------------------------------------------------------


class TestRuntimeLogTail:
    """Contract: runtime_log_tail parses structured JSON from _abox/logs/runtime.jsonl."""

    def test_returns_empty_when_file_missing(self, tmp_path):
        vol = _make_volume(tmp_path)
        assert vol.runtime_log_tail() == []

    def test_parses_valid_jsonl(self, tmp_path):
        vol = _make_volume(tmp_path)
        log_path = tmp_path / "_abox" / "logs" / "runtime.jsonl"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(
            '{"event": "boot", "ts": 1.0}\n'
            '{"event": "ready", "ts": 2.0}\n'
        )
        events = vol.runtime_log_tail()
        assert len(events) == 2
        assert events[0]["event"] == "boot"
        assert events[1]["event"] == "ready"

    def test_skips_malformed_lines(self, tmp_path):
        vol = _make_volume(tmp_path)
        log_path = tmp_path / "_abox" / "logs" / "runtime.jsonl"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(
            '{"event": "good"}\n'
            'not json at all\n'
            '{"event": "also_good"}\n'
        )
        events = vol.runtime_log_tail()
        assert len(events) == 2
        assert events[0]["event"] == "good"
        assert events[1]["event"] == "also_good"

    def test_respects_limit(self, tmp_path):
        vol = _make_volume(tmp_path)
        log_path = tmp_path / "_abox" / "logs" / "runtime.jsonl"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps({"event": f"e{i}", "ts": float(i)}) for i in range(20)]
        log_path.write_text("\n".join(lines) + "\n")
        events = vol.runtime_log_tail(limit=5)
        assert len(events) == 5
        assert events[0]["event"] == "e15"
        assert events[-1]["event"] == "e19"

    def test_skips_blank_lines(self, tmp_path):
        vol = _make_volume(tmp_path)
        log_path = tmp_path / "_abox" / "logs" / "runtime.jsonl"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(
            '{"event": "a"}\n'
            '\n'
            '   \n'
            '{"event": "b"}\n'
        )
        events = vol.runtime_log_tail()
        assert len(events) == 2


# ---------------------------------------------------------------------------
# write_runtime_diagnostics
# ---------------------------------------------------------------------------


class TestWriteRuntimeDiagnostics:
    """Contract: write_runtime_diagnostics writes valid JSON that can be read back."""

    def test_round_trip(self, tmp_path):
        vol = _make_volume(tmp_path)
        payload = {
            "agent_id": "a1",
            "container_status": "exited",
            "crash_info": {"exit_code": 137, "oom_killed": True},
        }
        vol.write_runtime_diagnostics(payload)

        diag_path = tmp_path / "_abox" / "runtime-diagnostics.json"
        assert diag_path.exists()
        written = json.loads(diag_path.read_text())
        assert written["agent_id"] == "a1"
        assert written["crash_info"]["oom_killed"] is True


# ---------------------------------------------------------------------------
# runtime projection edge cases
# ---------------------------------------------------------------------------


class TestRuntimeProjectionEdgeCases:
    """Contract: runtime projection handles all profile/stage combinations."""

    def test_empty_status_is_not_ready(self):
        assert runtime_status_meets_ready_boundary({}) is False

    def test_none_status_is_not_ready(self):
        assert runtime_status_meets_ready_boundary(None) is False

    def test_core_profile_ready_at_runtime_ready(self):
        assert runtime_status_meets_ready_boundary(
            {"profile": "core", "startup_stage": "runtime_ready"},
        ) is True

    def test_core_profile_not_ready_at_earlier_stage(self):
        assert runtime_status_meets_ready_boundary(
            {"profile": "core", "startup_stage": "platform_created"},
        ) is False

    def test_desktop_requires_relay_connected(self):
        assert runtime_status_meets_ready_boundary(
            {"profile": "desktop", "startup_stage": "managed_ready"},
            relay_connected=False,
        ) is False

    def test_desktop_requires_managed_ready_not_runtime_ready(self):
        assert runtime_status_meets_ready_boundary(
            {"profile": "desktop", "startup_stage": "runtime_ready"},
            relay_connected=True,
        ) is False

    def test_no_profile_defaults_to_non_desktop_path(self):
        """Missing profile should use the non-desktop path (runtime_ready is sufficient)."""
        assert runtime_status_meets_ready_boundary(
            {"startup_stage": "runtime_ready"},
        ) is True

    def test_agent_without_projection_attribute(self):
        """Agent with no runtime_status_projection attribute degrades safely."""
        agent = SimpleNamespace(relay_connected=True)
        assert agent_meets_ready_boundary(agent) is False

    def test_agent_with_none_projection(self):
        agent = SimpleNamespace(relay_connected=True, runtime_status_projection=None)
        assert agent_meets_ready_boundary(agent) is False


# ---------------------------------------------------------------------------
# LocalProjectVolumeStore contract
# ---------------------------------------------------------------------------


class TestLocalProjectVolumeStoreContract:
    """Contract: LocalProjectVolumeStore implements the basic store operations."""

    def test_write_and_read_text(self, tmp_path):
        store = _DirectStore(tmp_path)
        machine = AgentMachinePaths("proj1", "agent1")
        store.write_bytes(machine, "test.txt", b"hello world")
        assert store.read_text(machine, "test.txt") == "hello world"

    def test_exists(self, tmp_path):
        store = _DirectStore(tmp_path)
        machine = AgentMachinePaths("proj1", "agent1")
        assert store.exists(machine, "missing.txt") is False
        store.write_bytes(machine, "exists.txt", b"data")
        assert store.exists(machine, "exists.txt") is True

    def test_remove_tree(self, tmp_path):
        store = _DirectStore(tmp_path)
        machine = AgentMachinePaths("proj1", "agent1")
        store.write_bytes(machine, "dir/file.txt", b"data")
        assert store.exists(machine, "dir/file.txt")
        store.remove_tree(machine, "dir")
        assert not store.exists(machine, "dir/file.txt")

    def test_append_text(self, tmp_path):
        store = _DirectStore(tmp_path)
        machine = AgentMachinePaths("proj1", "agent1")
        store.append_text(machine, "log.jsonl", '{"a":1}\n')
        store.append_text(machine, "log.jsonl", '{"b":2}\n')
        content = store.read_text(machine, "log.jsonl")
        assert '{"a":1}' in content
        assert '{"b":2}' in content


# ---------------------------------------------------------------------------
# Provision-time file schema validation
# ---------------------------------------------------------------------------


class TestProvisionFileSchemas:
    """Contract: provision-time files are written in the correct format."""

    def test_theme_document_schema(self, tmp_path):
        vol = _make_volume(tmp_path)
        tokens = {"surface": "#1a1a2e", "accent": "#ff6b6b"}
        vol.write_theme_document(tokens, name="Test Project")

        path = tmp_path / "tmp" / "abox-theme" / "tokens.json"
        assert path.exists()
        doc = json.loads(path.read_text())
        assert doc["schema_version"] == THEME_SCHEMA_VERSION
        assert doc["name"] == "Test Project"
        assert doc["tokens"]["surface"] == "#1a1a2e"

    def test_state_document_schema(self, tmp_path):
        vol = _make_volume(tmp_path)
        vol.write_state_document("claude-sonnet-4-5-20250929", "auto", ["Bash", "Read"])

        path = tmp_path / "_abox" / "state.json"
        assert path.exists()
        doc = json.loads(path.read_text())
        assert doc["model"] == "claude-sonnet-4-5-20250929"
        assert doc["mode"] == "auto"
        assert doc["allowed_tools"] == ["Bash", "Read"]

    def test_inbox_append_schema(self, tmp_path):
        vol = _make_volume(tmp_path)
        vol.append_task(
            task_id="t1",
            content=[{"type": "text", "text": "hello"}],
        )

        path = tmp_path / "_abox" / "inbox.jsonl"
        assert path.exists()
        line = path.read_text().strip()
        msg = json.loads(line)
        assert msg["type"] == "task"
        assert msg["task_id"] == "t1"
        assert msg["input"]["role"] == "user"
        assert msg["input"]["content"][0]["text"] == "hello"

    def test_provisioned_sentinel(self, tmp_path):
        vol = _make_volume(tmp_path)
        token = "test-token-123"
        vol.mark_provisioned(token)

        path = tmp_path / "_abox" / "provisioned.ready"
        assert path.exists()
        assert token in path.read_text()
