"""Tests for GraphQL resolver adapter delegation and mutation side effects.

Verifies that display field resolvers read from latest_snapshot via adapter,
not from stale model columns. Also verifies that config mutations write the
expected agent-private files to the machine volume.
"""

import pytest
from unittest.mock import AsyncMock, patch, call
from asgiref.sync import sync_to_async
from django.test import RequestFactory

from agents.models import Agent, AgentStatus, SessionResult

pytestmark = pytest.mark.integration


@pytest.mark.django_db(transaction=True)
class TestResolverAdapterDelegation:
    """Principle: GraphQL resolvers must delegate to adapters, never access raw JSON.

    Display fields (lastOutput, liveAction, cost, duration, turns) are derived
    from latest_snapshot by the agent's adapter. Resolvers call get_adapter()
    and pass the snapshot — they never parse stream-json directly. This keeps
    the GraphQL layer agent-type-agnostic.
    """

    @pytest.fixture
    def agent(self, db):
        from projects.models import Project
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="test_resolver", password="test")
        project = Project.objects.create(name="Test Resolver", owner=user)
        return Agent.objects.create(
            name="resolver-test",
            project=project,
            runtime="docker",
            status=AgentStatus.RUNNING,
            agent_type="claude-code",
            latest_snapshot={
                "assistant": {
                    "type": "assistant",
                    "message": {
                        "content": [
                            {"type": "text", "text": "Snapshot text wins."},
                            {"type": "tool_use", "name": "Read", "id": "t1", "input": {}},
                        ]
                    },
                },
            },
            session_cost_usd=1.23,
        )

    def test_last_output_reads_from_snapshot(self, agent):
        """Resolver should return adapter output from snapshot."""
        from agents.graphql.types import AgentType
        result = AgentType.last_output(agent)
        assert result == "Snapshot text wins."

    def test_live_action_reads_from_snapshot(self, agent):
        from agents.graphql.types import AgentType
        result = AgentType.live_action(agent)
        assert result == "Read"

    def test_live_action_clears_when_result_present(self, agent):
        from agents.graphql.types import AgentType
        agent.latest_snapshot["result"] = {"type": "result", "duration_ms": 1000}
        result = AgentType.live_action(agent)
        assert result is None  # empty string -> None

    def test_duration_from_snapshot(self, agent):
        from agents.graphql.types import AgentType
        # No result in snapshot -> 0s
        result = AgentType.duration(agent)
        assert result == "0s"

        # Add result with duration
        agent.latest_snapshot["result"] = {"type": "result", "duration_ms": 125000}
        result = AgentType.duration(agent)
        assert result == "2m 05s"

    def test_turns_from_snapshot(self, agent):
        from agents.graphql.types import AgentType
        # No result in snapshot -> 0
        result = AgentType.turns(agent)
        assert result == 0

        # Add result with turns
        agent.latest_snapshot["result"] = {"type": "result", "num_turns": 7}
        result = AgentType.turns(agent)
        assert result == 7

    @pytest.mark.asyncio
    async def test_cost_resolves_inside_async_graphql_query(self, agent):
        """GraphQL agent query must not do sync ORM work in async execution."""
        from schema import schema

        request = RequestFactory().post("/graphql")
        request.user = agent.project.owner

        result = await schema.execute(
            """
            query ($agentId: ID!) {
                agent(agentId: $agentId) {
                    id
                    cost
                }
            }
            """,
            variable_values={"agentId": str(agent.id)},
            context_value={"request": request},
        )

        assert result.errors is None
        assert result.data is not None
        assert result.data["agent"]["id"] == str(agent.id)
        assert result.data["agent"]["cost"] == pytest.approx(1.23)

    @pytest.mark.asyncio
    async def test_cost_falls_back_to_session_field_without_history(self, agent):
        """cost falls back to the current session field before any results persist."""
        from agents.graphql.types import AgentType
        result = await AgentType.cost(agent)
        assert result == pytest.approx(1.23)

    @pytest.mark.asyncio
    async def test_cost_accumulates_latest_total_per_session(self, agent):
        """Agent card cost should survive restarts by summing session totals."""
        from agents.graphql.types import AgentType

        await sync_to_async(SessionResult.objects.create, thread_sensitive=False)(
            agent=agent,
            session_id="session-a",
            total_cost_usd=0.01,
            duration_ms=1000,
        )
        await sync_to_async(SessionResult.objects.create, thread_sensitive=False)(
            agent=agent,
            session_id="session-a",
            total_cost_usd=0.04,
            duration_ms=2000,
        )
        await sync_to_async(SessionResult.objects.create, thread_sensitive=False)(
            agent=agent,
            session_id="session-b",
            total_cost_usd=0.02,
            duration_ms=1000,
        )

        result = await AgentType.cost(agent)
        assert result == pytest.approx(0.06)

    def test_phase_still_reads_from_model(self, agent):
        """phase is an auto field that reads directly from the model."""
        agent.phase = "thinking"
        assert agent.phase == "thinking"


@pytest.mark.django_db(transaction=True)
class TestConfigMutationFileWrites:
    """Black-box mutation tests proving config resolvers write expected files.

    These complement the source-grep invariants in test_architecture.py with
    actual resolver execution. The writer is mocked at the import seam so we
    verify the resolver calls write() with the correct paths and content.
    """

    @pytest.fixture
    def agent_with_sandbox(self, db):
        from projects.models import Project
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="test_config_mut", password="pw")
        project = Project.objects.create(name="Vahid Eyorokon Config Test", owner=user)
        return Agent.objects.create(
            name="config-test-agent",
            project=project,
            runtime="docker",
            status=AgentStatus.IDLE,
            sandbox_id="sb-config-test",
            agent_type="claude-code",
            role="worker",
            instructions="original instructions",
            mcp_servers=[],
        )

    @pytest.mark.asyncio
    async def test_update_agent_instructions_writes_claude_md(self, agent_with_sandbox):
        """updateAgentInstructions must write home/agent/CLAUDE.md via writer."""
        from schema import schema

        mock_writer = AsyncMock()
        agent = agent_with_sandbox

        request = RequestFactory().post("/graphql")
        request.user = await sync_to_async(lambda: agent.project.owner)()

        with patch(
            "agents.services.machine_write.get_machine_writer",
            return_value=mock_writer,
        ):
            result = await schema.execute(
                """
                mutation ($input: UpdateAgentInstructionsInput!) {
                    updateAgentInstructions(input: $input) {
                        id
                        instructions
                    }
                }
                """,
                variable_values={
                    "input": {
                        "agentId": str(agent.id),
                        "instructions": "Vahid Eyorokon wants this behavior",
                    },
                },
                context_value={"request": request},
            )

        assert result.errors is None, f"Mutation errors: {result.errors}"
        assert result.data["updateAgentInstructions"]["instructions"] == "Vahid Eyorokon wants this behavior"

        # Verify writer.write was called with CLAUDE.md
        mock_writer.write.assert_awaited_once()
        write_path, write_content = mock_writer.write.call_args[0]
        assert write_path == "home/agent/CLAUDE.md"
        assert "Vahid Eyorokon wants this behavior" in write_content

    @pytest.mark.asyncio
    async def test_update_agent_config_writes_claude_md_and_mcp_json(self, agent_with_sandbox):
        """updateAgentConfig must write both CLAUDE.md and .mcp.json when MCP changes."""
        from schema import schema

        mock_writer = AsyncMock()
        agent = agent_with_sandbox

        request = RequestFactory().post("/graphql")
        request.user = await sync_to_async(lambda: agent.project.owner)()

        with patch(
            "agents.services.machine_write.get_machine_writer",
            return_value=mock_writer,
        ), patch(
            "agents.services.relay.update_volume_and_reload",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "agents.services.broadcast.broadcast_agent_update",
            new_callable=AsyncMock,
        ):
            result = await schema.execute(
                """
                mutation ($input: UpdateAgentConfigInput!) {
                    updateAgentConfig(input: $input) {
                        id
                    }
                }
                """,
                variable_values={
                    "input": {
                        "agentId": str(agent.id),
                        "mcpRegistryNames": ["playwright"],
                    },
                },
                context_value={"request": request},
            )

        assert result.errors is None, f"Mutation errors: {result.errors}"

        # Verify writer.write was called for both files
        write_calls = mock_writer.write.call_args_list
        written_paths = [c[0][0] for c in write_calls]
        assert "home/agent/CLAUDE.md" in written_paths, (
            f"Expected CLAUDE.md write, got paths: {written_paths}"
        )
        assert "home/agent/.mcp.json" in written_paths, (
            f"Expected .mcp.json write, got paths: {written_paths}"
        )

        # Verify .mcp.json has valid structure with the requested MCP server
        import json
        mcp_call = next(c for c in write_calls if c[0][0] == "home/agent/.mcp.json")
        mcp_config = json.loads(mcp_call[0][1])
        assert "mcpServers" in mcp_config, f"Missing mcpServers key: {mcp_config.keys()}"
        assert "playwright" in mcp_config["mcpServers"], (
            f"Expected playwright in mcpServers, got: {list(mcp_config['mcpServers'].keys())}"
        )
