"""Tests for GraphQL resolver adapter delegation.

Verifies that display field resolvers read from latest_snapshot via adapter,
not from stale model columns.
"""

import pytest

from agents.models import Agent, AgentStatus


@pytest.mark.django_db
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

    def test_cost_still_reads_from_model(self, agent):
        """cost reads from session_cost_usd column, not snapshot."""
        from agents.graphql.types import AgentType
        result = AgentType.cost(agent)
        assert result == pytest.approx(1.23)

    def test_phase_still_reads_from_model(self, agent):
        """phase is an auto field that reads directly from the model."""
        agent.phase = "thinking"
        assert agent.phase == "thinking"
