"""Shared adapter contract tests — registry, protocol compliance, graceful handling.

Tests that apply to ALL registered adapters live here. Agent-type-specific
tests live in test_adapter_cc.py (Claude Code) and test_adapter_oc.py (OpenCode).
"""

import pytest

from agents.adapters import get_adapter, register_adapter, _REGISTRY
from agents.adapters.base import AgentAdapter
from agents.adapters.claude_code import ClaudeCodeAdapter
from agents.adapters.opencode import OpenCodeAdapter


# ── Registry tests ──


class TestRegistry:
    """Principle: the adapter registry is the single lookup point for agent types.

    get_adapter(type) returns a cached adapter instance. Unknown types raise
    ValueError immediately — no silent fallback to a default adapter.
    """

    def test_get_claude_code_adapter(self):
        adapter = get_adapter("claude-code")
        assert adapter is not None
        assert isinstance(adapter, ClaudeCodeAdapter)

    def test_get_opencode_adapter(self):
        adapter = get_adapter("opencode")
        assert adapter is not None
        assert isinstance(adapter, OpenCodeAdapter)

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
            def wire_to_mode(self, wire_mode): return ""
            def mode_to_wire(self, mode): return ""
            def build_settings(self, *, api_key="", mode="auto"): return "{}"
            def build_instructions(self, *, project_name="", agent_name="",
                                   agent_role="worker", **kw): return ""
            def build_onboarding_state(self, *, api_key=""): return ""
            def build_mcp_config(self, *, mcp_servers=None, secret_envs=None,
                                 coord_server=None): return "{}"
            def build_api_key_files(self, api_key): return []
            def build_relay_env(self, **kw): return ""
            def available_models(self): return []
            def mcp_registry_entries(self): return []
            def resolve_mcp_servers(self, names, variant="debian"): return {}
            def resolve_mcp_instructions(self, mcp_servers): return []
            def team_configs(self): return {}
            def provision_paths(self, workspace): return {}

        register_adapter("fake-agent", FakeAdapter())
        adapter = get_adapter("fake-agent")
        assert isinstance(adapter, AgentAdapter)

        # Cleanup
        del _REGISTRY["fake-agent"]


# ── Protocol compliance ──


class TestProtocolCompliance:
    """Principle: every registered adapter must satisfy the AgentAdapter protocol.

    Runtime isinstance() check ensures all protocol methods exist with correct
    signatures. If a new method is added to AgentAdapter, every adapter must
    implement it or this test fails.
    """

    @pytest.mark.parametrize("agent_type", list(_REGISTRY.keys()))
    def test_adapter_satisfies_protocol(self, agent_type):
        adapter = get_adapter(agent_type)
        assert isinstance(adapter, AgentAdapter)


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
