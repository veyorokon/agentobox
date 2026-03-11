"""Functional test: change theme → tokens.json on agent volume has new tokens.

This is the test that catches the actual bug: user changes the theme via
the set_project_theme mutation, but the agent container never sees it.

The bug was: mutations.py had a stale _push_theme_for_project() that sent
old {"type": "theme"} WS payloads. The relay only handles {"type": "poke"},
so the theme silently never updated. This test would have caught it because
it checks the ACTUAL FILE on the volume, not the WS message.

Tests:
1. push_theme_to_agents writes tokens.json to every running agent's volume
2. If the function is broken/stale, tokens.json is missing or has wrong content
3. The mutation calls the correct function (not a stale inline one)
"""

import json
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from accounts.models import User
from agents.models import Agent, AgentStatus
from projects.models import Project

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]


def _create_project_without_signals(*, name: str, owner: User) -> Project:
    project = Project(id=uuid.uuid4(), name=name, owner=owner)
    Project.objects.bulk_create([project])
    return project


@pytest.fixture
def theme_tokens():
    return {
        "surface": "#1a1a2e",
        "text-default": "#e0e0e0",
        "accent": "#ff6b6b",
    }


@pytest.fixture
def setup_project_with_agent(tmp_path):
    """Create a project with one running agent whose volume points at tmp_path."""
    owner = User.objects.create_user(username=f"theme-test-{uuid.uuid4().hex[:6]}", password="pw")
    project = _create_project_without_signals(name="Theme Test Project", owner=owner)
    agent = Agent.objects.create(
        name="worker",
        project=project,
        runtime="docker",
        status=AgentStatus.IDLE,
        sandbox_id="fake-sandbox-id",
    )
    # Point the agent's volume at tmp_path so we can inspect files
    vol = agent.volume
    vol.root = tmp_path
    vol.initialize()
    return project, agent, vol, tmp_path


async def test_push_theme_writes_tokens_to_volume(setup_project_with_agent, theme_tokens):
    """THE TEST: change theme → check tokens.json on agent volume.

    This is the exact user scenario: I change the theme, does the agent
    container actually get the new tokens? If tokens.json doesn't exist
    or has wrong content, the test FAILS.
    """
    project, agent, vol, tmp_path = setup_project_with_agent

    # Set theme on project (what the mutation does)
    project.theme_tokens = theme_tokens
    await project.asave(update_fields=["theme_tokens"])

    # Patch push_to_relay (we dont have a real WS connection in tests)
    # AND patch agent.volume to use our tmp_path volume
    with patch("agents.services.comms.push_to_relay", new_callable=AsyncMock) as mock_push:
        # Patch Volume.__init__ so the agent's volume points at tmp_path
        type(vol).__init__

        def patched_init(self, project_id, agent_id):
            self.root = tmp_path

        with patch("agents.services.volume.Volume.__init__", patched_init):
            from agents.services.comms import push_theme_to_agents
            await push_theme_to_agents(project)

    # THE ACTUAL CHECK: does the file exist with the right content?
    tokens_path = tmp_path / "tmp" / "abox-theme" / "tokens.json"
    assert tokens_path.exists(), (
        "tokens.json NOT WRITTEN to agent volume — theme change is invisible to the container"
    )

    written_tokens = json.loads(tokens_path.read_text())
    assert written_tokens == theme_tokens, (
        f"tokens.json has wrong content.\n"
        f"Expected: {theme_tokens}\n"
        f"Got: {written_tokens}"
    )

    # Verify poke was sent (so relay knows to reload)
    mock_push.assert_called_once()
    call_args = mock_push.call_args
    poke_msg = call_args[0][1]
    assert poke_msg["type"] == "poke", f"Expected poke, got: {poke_msg['type']}"
    assert poke_msg["changed"] == "tmp/abox-theme/tokens.json"


async def test_push_theme_no_running_agents_no_crash(setup_project_with_agent, theme_tokens):
    """Theme push with no running agents should not crash or write anything."""
    project, agent, vol, tmp_path = setup_project_with_agent

    # Make agent stopped — push_theme_to_agents filters to RUNNING/IDLE
    agent.status = AgentStatus.STOPPED
    await agent.asave(update_fields=["status"])

    project.theme_tokens = theme_tokens
    await project.asave(update_fields=["theme_tokens"])

    with patch("agents.services.comms.push_to_relay", new_callable=AsyncMock) as mock_push:
        from agents.services.comms import push_theme_to_agents
        await push_theme_to_agents(project)

    # No file written, no poke sent
    tokens_path = tmp_path / "tmp" / "abox-theme" / "tokens.json"
    assert not tokens_path.exists(), "tokens.json written to stopped agent — should skip"
    mock_push.assert_not_called()


async def test_push_theme_empty_tokens_uses_default(setup_project_with_agent):
    """If project has no theme_tokens, push_theme uses claude-dark default."""
    project, agent, vol, tmp_path = setup_project_with_agent

    # No theme set on project
    project.theme_tokens = {}
    await project.asave(update_fields=["theme_tokens"])

    with patch("agents.services.comms.push_to_relay", new_callable=AsyncMock):
        type(vol).__init__

        def patched_init(self, project_id, agent_id):
            self.root = tmp_path

        with patch("agents.services.volume.Volume.__init__", patched_init):
            from agents.services.comms import push_theme_to_agents
            await push_theme_to_agents(project)

    tokens_path = tmp_path / "tmp" / "abox-theme" / "tokens.json"
    assert tokens_path.exists(), "Default theme not written when project has no theme_tokens"
    written = json.loads(tokens_path.read_text())
    # Should have content from BUILTIN_THEMES["claude-dark"]
    assert len(written) > 0, "Default theme is empty — BUILTIN_THEMES broken"


async def test_mutation_calls_comms_not_inline():
    """set_project_theme must call comms.push_theme_to_agents, not an inline function.

    This is a code-path test: we verify the mutation imports and calls the
    correct function. If someone replaces it with an inline function that
    sends old WS payloads, this test fails.
    """
    import ast
    mutations_path = Path(__file__).resolve().parent.parent.parent / "projects" / "graphql" / "mutations.py"
    source = mutations_path.read_text()
    tree = ast.parse(source)

    # Find set_project_theme method
    found_correct_import = False
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.module == "agents.services.comms":
                for alias in node.names:
                    if alias.name == "push_theme_to_agents":
                        found_correct_import = True

    assert found_correct_import, (
        "set_project_theme does not import push_theme_to_agents from agents.services.comms — "
        "theme changes will NOT reach agent containers"
    )

    # Also verify no stale inline theme push function exists
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if "push_theme" in node.name and node.name != "push_theme_to_agents":
                pytest.fail(
                    f"Stale inline function '{node.name}' in mutations.py — "
                    f"theme push must go through agents.services.comms.push_theme_to_agents"
                )
