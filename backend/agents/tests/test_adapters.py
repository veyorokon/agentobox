"""Contract tests for the adapter layer.

Tests verify:
    1. Protocol compliance — every registered adapter satisfies AgentAdapter
    2. Extraction correctness — display fields extracted from sample data
    3. Graceful handling — None/empty/{} inputs don't crash
    4. Registry — get_adapter works, unknown types raise ValueError
"""

import pytest

from agents.adapters import get_adapter, register_adapter, _REGISTRY
from agents.adapters.base import AgentAdapter
from agents.adapters.claude_code import ClaudeCodeAdapter
from agents.tests.conftest import SAMPLE_SNAPSHOTS, SAMPLE_EVENTS


# ── Registry tests ──


class TestRegistry:
    def test_get_claude_code_adapter(self):
        adapter = get_adapter("claude-code")
        assert adapter is not None
        assert isinstance(adapter, ClaudeCodeAdapter)

    def test_unknown_type_raises(self):
        with pytest.raises(ValueError, match="No adapter registered"):
            get_adapter("unknown-agent-type")

    def test_register_custom_adapter(self):
        class FakeAdapter:
            def last_output(self, snapshot): return ""
            def live_action(self, snapshot): return ""
            def cost(self, snapshot): return 0.0
            def duration(self, snapshot): return "0s"
            def duration_ms(self, snapshot): return 0
            def turns(self, snapshot): return 0
            def is_permission_request(self, event): return None
            def is_plan_proposal(self, event): return None

        register_adapter("fake-agent", FakeAdapter())
        adapter = get_adapter("fake-agent")
        assert isinstance(adapter, AgentAdapter)

        # Cleanup
        del _REGISTRY["fake-agent"]


# ── Protocol compliance ──


class TestProtocolCompliance:
    @pytest.mark.parametrize("agent_type", list(_REGISTRY.keys()))
    def test_adapter_satisfies_protocol(self, agent_type):
        adapter = get_adapter(agent_type)
        assert isinstance(adapter, AgentAdapter)


# ── Claude Code adapter extraction ──


class TestClaudeCodeExtraction:
    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    # -- last_output --

    def test_last_output_from_assistant(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["assistant_only"]
        assert adapter.last_output(snap) == "I'll fix the bug in the login flow."

    def test_last_output_from_result_snap(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.last_output(snap) == "Fixed the authentication bug."

    def test_last_output_empty_snapshot(self, adapter):
        assert adapter.last_output({}) == ""

    def test_last_output_none_assistant(self, adapter):
        assert adapter.last_output({"assistant": None}) == ""

    def test_last_output_truncates_to_500(self, adapter):
        snap = {
            "assistant": {
                "message": {
                    "content": [{"type": "text", "text": "x" * 1000}]
                }
            }
        }
        assert len(adapter.last_output(snap)) == 500

    # -- live_action --

    def test_live_action_during_tool_use(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["assistant_only"]
        assert adapter.live_action(snap) == "Edit"

    def test_live_action_clears_after_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.live_action(snap) == ""

    def test_live_action_empty_snapshot(self, adapter):
        assert adapter.live_action({}) == ""

    def test_live_action_none_snapshot(self, adapter):
        assert adapter.live_action(None) == ""

    # -- cost --

    def test_cost_from_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.cost(snap) == pytest.approx(0.045)

    def test_cost_no_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["assistant_only"]
        assert adapter.cost(snap) == 0.0

    def test_cost_empty_snapshot(self, adapter):
        assert adapter.cost({}) == 0.0

    # -- duration --

    def test_duration_formatted(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.duration(snap) == "2m 05s"

    def test_duration_short(self, adapter):
        snap = {"result": {"duration_ms": 45000}}
        assert adapter.duration(snap) == "45s"

    def test_duration_empty(self, adapter):
        assert adapter.duration({}) == "0s"

    # -- duration_ms --

    def test_duration_ms_from_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.duration_ms(snap) == 125000

    def test_duration_ms_empty(self, adapter):
        assert adapter.duration_ms({}) == 0

    # -- turns --

    def test_turns_from_result(self, adapter):
        snap = SAMPLE_SNAPSHOTS["claude-code"]["with_result"]
        assert adapter.turns(snap) == 7

    def test_turns_no_result(self, adapter):
        assert adapter.turns({}) == 0

    # -- is_permission_request --

    def test_permission_request_detected(self, adapter):
        event = SAMPLE_EVENTS["claude-code"]["permission_request"]
        result = adapter.is_permission_request(event)
        assert result is not None
        assert result["tool_use_id"] == "toolu_perm_01"
        assert "rm -rf" in result["command"]

    def test_normal_event_no_permission(self, adapter):
        event = SAMPLE_EVENTS["claude-code"]["normal_assistant"]
        assert adapter.is_permission_request(event) is None

    def test_permission_empty_event(self, adapter):
        assert adapter.is_permission_request({}) is None

    # -- is_plan_proposal --

    def test_plan_proposal_detected(self, adapter):
        event = SAMPLE_EVENTS["claude-code"]["plan_proposal"]
        result = adapter.is_plan_proposal(event)
        assert result is not None
        assert result["tool_use_id"] == "toolu_plan_01"
        assert "Fix auth" in result["plan"]

    def test_normal_event_no_plan(self, adapter):
        event = SAMPLE_EVENTS["claude-code"]["normal_assistant"]
        assert adapter.is_plan_proposal(event) is None

    def test_plan_empty_event(self, adapter):
        assert adapter.is_plan_proposal({}) is None


# ── Parametrized graceful handling across all adapters ──


class TestGracefulHandling:
    """Every registered adapter must handle degenerate input without crashing."""

    @pytest.mark.parametrize("agent_type", list(_REGISTRY.keys()))
    def test_all_methods_handle_empty(self, agent_type):
        adapter = get_adapter(agent_type)
        # None of these should raise
        assert isinstance(adapter.last_output({}), str)
        assert isinstance(adapter.live_action({}), str)
        assert isinstance(adapter.cost({}), float)
        assert isinstance(adapter.duration({}), str)
        assert isinstance(adapter.duration_ms({}), int)
        assert isinstance(adapter.turns({}), int)
        assert adapter.is_permission_request({}) is None
        assert adapter.is_plan_proposal({}) is None

    @pytest.mark.parametrize("agent_type", list(_REGISTRY.keys()))
    def test_all_methods_handle_none_values(self, agent_type):
        adapter = get_adapter(agent_type)
        snap = {"assistant": None, "result": None}
        assert isinstance(adapter.last_output(snap), str)
        assert isinstance(adapter.live_action(snap), str)
        assert isinstance(adapter.cost(snap), float)
        assert isinstance(adapter.duration(snap), str)
        assert isinstance(adapter.duration_ms(snap), int)
        assert isinstance(adapter.turns(snap), int)
