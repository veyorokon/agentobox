from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from agents.services.project_volume import AgentMachinePaths, LocalProjectVolumeStore
from agents.services.provision import provision_workspace
from agents.services.volume import AgentMachine


def _make_vol(tmp_path: Path) -> AgentMachine:
    class _DirectStore(LocalProjectVolumeStore):
        def local_machine_root(self, machine: AgentMachinePaths) -> Path:
            return tmp_path

        def _full_path(self, machine: AgentMachinePaths, path: str = "") -> Path:
            return tmp_path / path if path else tmp_path

    vol = AgentMachine.__new__(AgentMachine)
    vol._machine = AgentMachinePaths(project_id="proj-test", agent_id="agent-test")
    vol._store = _DirectStore(tmp_path)
    vol.root = tmp_path
    return vol


@pytest.mark.asyncio
async def test_provision_workspace_writes_files_under_agent_home(tmp_path, monkeypatch):
    vol = _make_vol(tmp_path)
    vol.initialize()

    async def _no_skills(*_args, **_kwargs):
        return None

    monkeypatch.setattr("agents.services.provision._provision_skills_to_volume", _no_skills)

    project = SimpleNamespace(id="proj-1", name="Manual Modal Proof")

    await provision_workspace(
        vol=vol,
        project=project,
        agent_type="claude-code",
        api_key="",
        mcp_servers=None,
        instructions="Return the smoke token exactly.",
        agent_name="team-lead",
        agent_role="lead",
        team_members=[],
        team_name="manual-proof",
        relay_token="relay-token",
        callback_url="https://dev.agentobox.com",
        mode="auto",
        model="claude-opus-4-6",
        agent_tags=[],
    )

    assert (tmp_path / "home/agent").is_dir()
    assert (tmp_path / "home/agent/CLAUDE.md").exists()
    assert (tmp_path / "home/agent/.claude/settings.json").exists()
    assert (tmp_path / "home/agent/.mcp.json").exists()
    assert (tmp_path / "home/agent/.claude.json").exists()
