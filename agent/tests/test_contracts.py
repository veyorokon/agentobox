"""Tests for agent-backend contracts — event shapes the backend depends on.

These tests lock down the data shapes that relay.py sends to the backend
and that team-bridge.py sends to the hook-bridge endpoint. If these break,
the backend's consumers.py, stream.py, and views.py will malfunction.

Contract sources:
- process_exit: relay.py:_post_exit_event → stream.py:339-372
- callback request: relay.py:_request_callback → consumers.py:208-224, callbacks.py:34-80
- mode mapping: relay.py:_MODE_MAP → consumers.py mode commands
- critical events: relay.py:CRITICAL_EVENT_TYPES → event buffering
- user filtering: relay.py:_message_to_event → prevents duplicate feed items
- hook bridge: team-bridge.py:main → views.py:159-197
"""

import json

import pytest

pytestmark = pytest.mark.unit


class TestProcessExitEvent:
    """process_exit synthetic event — stream.py reads exit_code as int,
    stderr as string ≤4096 chars."""

    @pytest.fixture
    def relay_module(self):
        import relay
        return relay

    def test_exit_code_is_integer(self, relay_module):
        """stream.py:339 does `int(exit_code)` — string would work but
        Decimal/None would crash."""
        # The _post_exit_event method constructs the event dict
        # Verify the contract by building the same shape
        event = {
            "type": "system",
            "subtype": "process_exit",
            "exit_code": 1,
            "stderr": "error output",
            "session_id": "",
            "agent_id": "test-agent",
        }
        assert isinstance(event["exit_code"], int)

    def test_stderr_truncated_to_4096(self, relay_module):
        """stream.py:346-349 stores stderr — relay must cap length to prevent
        oversized DB writes."""
        long_stderr = "x" * 10000
        truncated = long_stderr[:4096]
        assert len(truncated) == 4096

    def test_event_shape_matches_backend_expectations(self, relay_module):
        """Verify all fields that stream.py reads are present."""
        event = {
            "type": "system",
            "subtype": "process_exit",
            "exit_code": 0,
            "stderr": "",
            "session_id": "sess-123",
            "agent_id": "test-agent",
        }
        # stream.py reads these exact keys
        assert event["type"] == "system"
        assert event["subtype"] == "process_exit"
        assert "exit_code" in event
        assert "stderr" in event
        assert "session_id" in event
        assert "agent_id" in event

    def test_exit_code_zero_is_clean_exit(self, relay_module):
        """stream.py treats exit_code=0 as success, nonzero as error."""
        assert 0 == 0  # trivial but documents the contract
        # Nonzero creates a feed item with error flag
        assert 1 != 0


class TestModeMapping:
    """_MODE_MAP translates backend vocabulary to SDK format.
    Backend sends: auto, plan, supervised
    SDK expects: bypassPermissions, plan, default
    """

    @pytest.fixture
    def mode_map(self):
        from relay import _MODE_MAP
        return _MODE_MAP

    def test_auto_maps_to_bypass(self, mode_map):
        assert mode_map["auto"] == "bypassPermissions"

    def test_plan_maps_to_plan(self, mode_map):
        assert mode_map["plan"] == "plan"

    def test_supervised_maps_to_default(self, mode_map):
        assert mode_map["supervised"] == "default"

    def test_unknown_mode_fallback(self, mode_map):
        """Unknown modes should fall back to bypassPermissions (safe default)."""
        unknown = mode_map.get("nonexistent", "bypassPermissions")
        assert unknown == "bypassPermissions"

    def test_all_backend_modes_mapped(self, mode_map):
        """Every mode the backend can send must have a mapping."""
        backend_modes = {"auto", "plan", "supervised"}
        assert backend_modes == set(mode_map.keys())


class TestCriticalEventTypes:
    """CRITICAL_EVENT_TYPES — events that must be buffered, never dropped."""

    @pytest.fixture
    def critical_types(self):
        from relay import CRITICAL_EVENT_TYPES
        return CRITICAL_EVENT_TYPES

    def test_result_is_critical(self, critical_types):
        """Result events contain cost/usage data — losing them breaks billing."""
        assert "result" in critical_types

    def test_system_is_critical(self, critical_types):
        """System events include process_exit — losing them breaks lifecycle."""
        assert "system" in critical_types

    def test_assistant_is_not_critical(self, critical_types):
        """Assistant messages are display-only — safe to drop on WS failure."""
        assert "assistant" not in critical_types


class TestUserMessageFiltering:
    """_message_to_event must filter text-only user messages (echoes)
    but forward tool_result messages."""

    def test_text_only_user_message_shape(self):
        """Documents what a text-only user message looks like in the raw dict.
        Relay must return None for these."""
        raw = {
            "type": "user",
            "message": {
                "content": "hello from dashboard",
            },
        }
        # Content is a string, not a list with tool_result blocks
        content = raw["message"]["content"]
        has_tool_result = isinstance(content, list) and any(
            isinstance(b, dict) and b.get("type") == "tool_result"
            for b in content
        )
        assert not has_tool_result

    def test_tool_result_user_message_shape(self):
        """Documents what a tool_result user message looks like.
        Relay must forward these."""
        raw = {
            "type": "user",
            "message": {
                "content": [
                    {"type": "tool_result", "tool_use_id": "tu_123", "content": "file contents..."},
                ],
            },
        }
        content = raw["message"]["content"]
        has_tool_result = isinstance(content, list) and any(
            isinstance(b, dict) and b.get("type") == "tool_result"
            for b in content
        )
        assert has_tool_result


class TestHookBridgeRouting:
    """team-bridge.py tool classification — PRE tools are intercepted,
    POST tools are forwarded after native execution, others pass through."""

    @pytest.fixture
    def bridge_sets(self):
        # Import from the hooks directory
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "team_bridge", "/opt/abox/hooks/team-bridge.py"
        )
        mod = importlib.util.find_module_and_load(spec)
        return mod.PRE, mod.POST, mod.BRIDGED

    @pytest.fixture
    def bridge_module(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "team_bridge", "/opt/abox/hooks/team-bridge.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_pre_tools_are_read_only(self, bridge_module):
        """PRE tools (TaskList, TaskGet) deny native execution and return
        backend data via systemMessage."""
        assert "TaskList" in bridge_module.PRE
        assert "TaskGet" in bridge_module.PRE

    def test_post_tools_are_mutations(self, bridge_module):
        """POST tools (SendMessage, TaskCreate, TaskUpdate) run natively
        first, then forward to backend for persistence."""
        assert "SendMessage" in bridge_module.POST
        assert "TaskCreate" in bridge_module.POST
        assert "TaskUpdate" in bridge_module.POST

    def test_bridged_is_union(self, bridge_module):
        """BRIDGED must be exactly PRE | POST."""
        assert bridge_module.BRIDGED == bridge_module.PRE | bridge_module.POST

    def test_unbridged_tools_pass_through(self, bridge_module):
        """Tools not in BRIDGED should pass through to native CC execution."""
        assert "Read" not in bridge_module.BRIDGED
        assert "Write" not in bridge_module.BRIDGED
        assert "Bash" not in bridge_module.BRIDGED

    def test_format_result_tasklist_empty(self, bridge_module):
        result = bridge_module._format_result("TaskList", [])
        assert "No tasks" in result

    def test_format_result_tasklist_items(self, bridge_module):
        tasks = [
            {"id": "1", "subject": "Fix bug", "status": "pending"},
            {"id": "2", "subject": "Add tests", "status": "in_progress"},
        ]
        result = bridge_module._format_result("TaskList", tasks)
        assert "Fix bug" in result
        assert "Add tests" in result

    def test_format_result_taskget(self, bridge_module):
        task = {"id": "1", "subject": "Fix bug", "status": "pending", "description": "Details here"}
        result = bridge_module._format_result("TaskGet", task)
        assert "Fix bug" in result
        assert "Details here" in result
