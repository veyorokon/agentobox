"""Contract tests for the adapter layer.

Tests verify:
    1. Protocol compliance — every registered adapter satisfies AgentAdapter
    2. Extraction correctness — display fields extracted from sample data
    3. Graceful handling — None/empty/{} inputs don't crash
    4. Registry — get_adapter works, unknown types raise ValueError
    5. Seed data parity — seed_dev_data snapshots match real CC event structure
    6. Real event parity — adapter handles actual CC v2.1.59 stream-json events
"""

import pytest

from agents.adapters import get_adapter, register_adapter, _REGISTRY
from agents.adapters.base import AgentAdapter
from agents.adapters.claude_code import ClaudeCodeAdapter
from agents.tests.conftest import (
    SAMPLE_SNAPSHOTS, SAMPLE_EVENTS, SEED_AGENTS,
    REAL_CC_FIXTURES, _events_by_type,
)


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


# ── Seed data parity ──


class TestSeedDataParity:
    """Verify seed_dev_data snapshots produce correct adapter output.

    This is the contract test: if seed snapshot structure drifts from what
    the adapter expects (or vice versa), these tests catch it.
    """

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_last_output(self, adapter, agent):
        assert adapter.last_output(agent["snapshot"]) == agent["expected"]["last_output"]

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_live_action(self, adapter, agent):
        assert adapter.live_action(agent["snapshot"]) == agent["expected"]["live_action"]

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_duration(self, adapter, agent):
        assert adapter.duration(agent["snapshot"]) == agent["expected"]["duration"]

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_turns(self, adapter, agent):
        assert adapter.turns(agent["snapshot"]) == agent["expected"]["turns"]

    @pytest.mark.parametrize(
        "agent",
        SEED_AGENTS,
        ids=[a["name"] for a in SEED_AGENTS],
    )
    def test_cost(self, adapter, agent):
        assert adapter.cost(agent["snapshot"]) == pytest.approx(agent["expected"]["cost"])


# ── Real CC event parity ──


class TestRealEventParity:
    """Verify adapter handles actual Claude Code v2.1.59 stream-json events.

    Fixtures in tests/fixtures/ are sanitized captures from real CC sessions
    (solo, tool use, plan mode, team mode). These tests prove our adapter
    can extract display fields from events with the FULL real structure,
    not just simplified test snapshots.
    """

    @pytest.fixture
    def adapter(self):
        return ClaudeCodeAdapter()

    # -- text_only session: system → assistant(text) → result --

    def test_text_only_snapshot_extracts(self, adapter):
        """Build a snapshot from real text-only events and extract all fields."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        assistant = events["assistant"][0]
        result = events["result"][0]
        snapshot = {"assistant": assistant, "result": result}

        assert adapter.last_output(snapshot) == "4"
        assert adapter.live_action(snapshot) == ""  # result present → cleared
        assert adapter.turns(snapshot) == 1
        assert adapter.cost(snapshot) == pytest.approx(0.2177, abs=0.01)
        assert adapter.duration_ms(snapshot) == 1745
        assert adapter.duration(snapshot) == "1s"

    def test_text_only_no_result_yet(self, adapter):
        """Mid-turn: only assistant event, no result yet."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        assistant = events["assistant"][0]
        snapshot = {"assistant": assistant}

        assert adapter.last_output(snapshot) == "4"
        assert adapter.live_action(snapshot) == ""  # no tool_use block
        assert adapter.turns(snapshot) == 0
        assert adapter.cost(snapshot) == 0.0

    # -- tool_use session: system → assistant(tool) → user → assistant(text) → result --

    def test_tool_use_mid_turn(self, adapter):
        """Mid-turn with active tool use — live_action should show tool name."""
        events = _events_by_type(REAL_CC_FIXTURES["tool_use"])
        # First assistant event has tool_use
        first_assistant = events["assistant"][0]
        snapshot = {"assistant": first_assistant}

        output = adapter.last_output(snapshot)
        action = adapter.live_action(snapshot)
        # First assistant in tool_use fixture has a tool_use content block
        assert action == "Read"  # the tool used in our captured fixture

    def test_tool_use_completed(self, adapter):
        """Completed tool_use session — last assistant + result."""
        events = _events_by_type(REAL_CC_FIXTURES["tool_use"])
        last_assistant = events["assistant"][-1]
        result = events["result"][0]
        snapshot = {"assistant": last_assistant, "result": result}

        assert adapter.live_action(snapshot) == ""  # result present
        assert adapter.turns(snapshot) == 2
        assert isinstance(adapter.last_output(snapshot), str)
        assert len(adapter.last_output(snapshot)) > 0

    # -- plan_mode session: includes ExitPlanMode tool use --

    def test_plan_mode_detects_plan_proposal(self, adapter):
        """ExitPlanMode tool use should be detected as a plan proposal."""
        events = _events_by_type(REAL_CC_FIXTURES["plan_mode"])
        for assistant_ev in events["assistant"]:
            result = adapter.is_plan_proposal(assistant_ev)
            if result is not None:
                assert "tool_use_id" in result
                assert "plan" in result
                break
        else:
            pytest.fail("No plan proposal detected in plan_mode fixture")

    def test_plan_mode_snapshot_extracts(self, adapter):
        """Full plan_mode session builds valid snapshot."""
        events = _events_by_type(REAL_CC_FIXTURES["plan_mode"])
        last_assistant = events["assistant"][-1]
        result = events["result"][0]
        snapshot = {"assistant": last_assistant, "result": result}

        # All extraction methods should work without error
        assert isinstance(adapter.last_output(snapshot), str)
        assert isinstance(adapter.live_action(snapshot), str)
        assert isinstance(adapter.duration(snapshot), str)
        assert adapter.turns(snapshot) >= 1

    # -- team_mode: same structure as solo (verified empirically) --

    def test_team_mode_same_structure(self, adapter):
        """Team mode events have identical structure to solo mode."""
        events = _events_by_type(REAL_CC_FIXTURES["team_mode"])
        assistant = events["assistant"][0]
        result = events["result"][0]
        snapshot = {"assistant": assistant, "result": result}

        # All methods work identically
        assert isinstance(adapter.last_output(snapshot), str)
        assert adapter.live_action(snapshot) == ""  # result present
        assert adapter.turns(snapshot) >= 1
        assert adapter.cost(snapshot) > 0
        assert adapter.duration_ms(snapshot) > 0

    # -- structural assertions: real events have fields our simplified fixtures lack --

    def test_real_assistant_has_expected_top_level_keys(self):
        """Real assistant events must have these keys (regression guard)."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        assistant = events["assistant"][0]
        required_top = {"type", "message", "session_id"}
        assert required_top.issubset(assistant.keys()), (
            f"Missing top-level keys: {required_top - assistant.keys()}"
        )

    def test_real_assistant_message_has_expected_keys(self):
        """Real assistant.message must have these keys."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        msg = events["assistant"][0]["message"]
        required_msg = {"id", "type", "role", "content", "model"}
        assert required_msg.issubset(msg.keys()), (
            f"Missing message keys: {required_msg - msg.keys()}"
        )

    def test_real_result_has_expected_keys(self):
        """Real result events must have these keys (regression guard)."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        result = events["result"][0]
        required = {
            "type", "is_error", "duration_ms", "duration_api_ms",
            "num_turns", "total_cost_usd", "session_id", "modelUsage",
        }
        assert required.issubset(result.keys()), (
            f"Missing result keys: {required - result.keys()}"
        )

    def test_real_system_init_has_expected_keys(self):
        """Real system/init events must have these keys."""
        events = _events_by_type(REAL_CC_FIXTURES["text_only"])
        init = events["system"][0]
        required = {
            "type", "subtype", "session_id", "tools", "model",
            "permissionMode", "claude_code_version",
        }
        assert required.issubset(init.keys()), (
            f"Missing system/init keys: {required - init.keys()}"
        )
