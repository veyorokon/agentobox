"""OpenCode CC event synthesis tests — adapter.normalize() state machine.

Tests the OpenCodeAdapter.normalize() method which translates OpenCode
SSE events into CC-compatible events. This is a stateful state machine
with hidden invariants: turn start, text accumulation, tool tracking,
turn completion, and state reset.

normalize(event, state) -> list[dict]:
    - event: raw OC SSE event {type, properties: {...}}
    - state: mutable dict persisted across calls (turn tracking)
    - returns: 0+ CC-format events (assistant, result, user)

Unlike the old relay-side synthesis, this tests the ACTUAL adapter code.
"""

import pytest
from unittest.mock import patch

from agents.adapters.opencode import OpenCodeAdapter


def oc_event(event_type: str, props: dict | None = None) -> dict:
    """Build an OpenCode SSE event dict."""
    return {"type": event_type, "properties": props or {}}


def by_type(events: list[dict], event_type: str) -> list[dict]:
    return [e for e in events if e.get("type") == event_type]


def feed_sequence(adapter, state, events: list[dict]) -> list[dict]:
    """Feed a sequence of OC events, return all emitted CC events."""
    result = []
    for event in events:
        result.extend(adapter.normalize(event, state))
    return result


# ── Tests ──


class TestTurnLifecycle:
    """Core turn lifecycle: busy → deltas → idle → events emitted."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    @pytest.fixture
    def state(self):
        return {}

    def test_basic_turn(self, adapter, state):
        """busy → text deltas → idle produces assistant + result events."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.updated", {"info": {"role": "assistant", "id": "msg_001"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "hello "}),
            oc_event("message.part.delta", {"field": "text", "delta": "world"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        results = by_type(cc, "result")

        assert len(assistants) == 2
        assert len(results) == 1

        # Initial assistant has empty content (triggers RUNNING)
        assert assistants[0]["message"]["content"] == []

        # Final assistant has accumulated text
        assert assistants[1]["message"]["content"] == [
            {"type": "text", "text": "hello world"}
        ]
        assert assistants[1]["message"]["id"] == "msg_001"

        # Result
        assert results[0]["is_error"] is False
        assert results[0]["num_turns"] == 1

    def test_turn_without_text(self, adapter, state):
        """busy → idle with no text deltas — result emitted, no final assistant."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        results = by_type(cc, "result")

        # Only initial assistant (no final one since no text or tools)
        assert len(assistants) == 1
        assert assistants[0]["message"]["content"] == []

        # Result still emitted
        assert len(results) == 1

    def test_multiple_turns(self, adapter, state):
        """Two consecutive turns produce independent event sets."""
        # Turn 1
        cc1 = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.updated", {"info": {"role": "assistant", "id": "msg_001"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "first"}),
            oc_event("session.idle"),
        ])

        # Turn 2
        cc2 = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.updated", {"info": {"role": "assistant", "id": "msg_002"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "second"}),
            oc_event("session.idle"),
        ])

        all_cc = cc1 + cc2
        assistants = by_type(all_cc, "assistant")
        results = by_type(all_cc, "result")

        # 2 initial + 2 final = 4 assistant events
        assert len(assistants) == 4
        assert len(results) == 2

        # Turn 1 text
        assert assistants[1]["message"]["content"][0]["text"] == "first"
        assert assistants[1]["message"]["id"] == "msg_001"

        # Turn 2 text — must NOT contain turn 1 text (state was reset)
        assert assistants[3]["message"]["content"][0]["text"] == "second"
        assert assistants[3]["message"]["id"] == "msg_002"


class TestToolSynthesis:
    """Tool events (tool.started, tool.completed) → CC content blocks."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    @pytest.fixture
    def state(self):
        return {}

    def test_tool_use_in_assistant(self, adapter, state):
        """tool.started events become tool_use content blocks in the assistant event."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "Let me read that file."}),
            oc_event("tool.started", {
                "toolName": "Read",
                "callID": "call_001",
                "input": {"file_path": "/tmp/test.py"},
            }),
            oc_event("tool.completed", {
                "callID": "call_001",
                "result": "file contents here",
            }),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        # Final assistant should have text + tool_use
        final = [a for a in assistants if a["message"]["content"]]
        assert len(final) == 1
        content = final[0]["message"]["content"]
        assert len(content) == 2
        assert content[0] == {"type": "text", "text": "Let me read that file."}
        assert content[1]["type"] == "tool_use"
        assert content[1]["id"] == "call_001"
        assert content[1]["name"] == "Read"
        assert content[1]["input"] == {"file_path": "/tmp/test.py"}

    def test_tool_results_as_user_event(self, adapter, state):
        """tool.completed events emit a user event with tool_result blocks."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("tool.started", {
                "toolName": "Bash",
                "callID": "call_002",
                "input": {"command": "ls"},
            }),
            oc_event("tool.completed", {
                "callID": "call_002",
                "result": "file1.py\nfile2.py",
            }),
            oc_event("session.idle"),
        ])

        users = by_type(cc, "user")
        assert len(users) == 1
        content = users[0]["message"]["content"]
        assert len(content) == 1
        assert content[0]["type"] == "tool_result"
        assert content[0]["tool_use_id"] == "call_002"
        assert "file1.py" in content[0]["content"]

    def test_multiple_tools_in_turn(self, adapter, state):
        """Multiple tool.started events accumulate in a single assistant event."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("tool.started", {"toolName": "Read", "callID": "c1", "input": {}}),
            oc_event("tool.completed", {"callID": "c1", "result": "ok"}),
            oc_event("tool.started", {"toolName": "Write", "callID": "c2", "input": {}}),
            oc_event("tool.completed", {"callID": "c2", "result": "done"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert len(final) == 1
        tool_blocks = [b for b in final[0]["message"]["content"] if b["type"] == "tool_use"]
        assert len(tool_blocks) == 2
        assert tool_blocks[0]["name"] == "Read"
        assert tool_blocks[1]["name"] == "Write"

        users = by_type(cc, "user")
        assert len(users) == 1
        results = users[0]["message"]["content"]
        assert len(results) == 2

    def test_tool_error_tracked(self, adapter, state):
        """tool.completed with error=True marks the tool_result as error."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("tool.started", {"toolName": "Bash", "callID": "c1", "input": {}}),
            oc_event("tool.completed", {"callID": "c1", "result": "command not found", "error": True}),
            oc_event("session.idle"),
        ])

        users = by_type(cc, "user")
        assert users[0]["message"]["content"][0]["is_error"] is True

    def test_tool_without_completed(self, adapter, state):
        """tool.started without tool.completed still shows in assistant content."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("tool.started", {"toolName": "Read", "callID": "c1", "input": {}}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert len(final) == 1
        assert final[0]["message"]["content"][0]["type"] == "tool_use"

        # No user event since no tool.completed
        users = by_type(cc, "user")
        assert len(users) == 0


class TestStateReset:
    """Verify state resets correctly between turns."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    @pytest.fixture
    def state(self):
        return {}

    def test_text_doesnt_leak_between_turns(self, adapter, state):
        """Text from turn 1 must not appear in turn 2."""
        feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "leak_test"}),
            oc_event("session.idle"),
        ])

        cc2 = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "clean"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc2, "assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert final[0]["message"]["content"][0]["text"] == "clean"
        assert "leak_test" not in final[0]["message"]["content"][0]["text"]

    def test_msg_id_doesnt_leak_between_turns(self, adapter, state):
        """Message ID from turn 1 must not appear in turn 2 if not set."""
        feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.updated", {"info": {"role": "assistant", "id": "msg_turn1"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "t1"}),
            oc_event("session.idle"),
        ])

        cc2 = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "t2"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc2, "assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert final[0]["message"]["id"] != "msg_turn1"

    def test_tools_dont_leak_between_turns(self, adapter, state):
        """Tool blocks from turn 1 must not appear in turn 2."""
        feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("tool.started", {"toolName": "Read", "callID": "c1", "input": {}}),
            oc_event("session.idle"),
        ])

        cc2 = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "no tools"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc2, "assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert len(final[0]["message"]["content"]) == 1
        assert final[0]["message"]["content"][0]["type"] == "text"


class TestEdgeCases:
    """Edge cases and non-obvious behaviors."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    @pytest.fixture
    def state(self):
        return {}

    def test_duplicate_busy_ignored(self, adapter, state):
        """Multiple busy events without idle should not create multiple starts."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "hi"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        initial = [a for a in assistants if a["message"]["content"] == []]
        assert len(initial) == 1

    def test_idle_without_busy_is_noop(self, adapter, state):
        """Idle event without preceding busy should not emit anything."""
        cc = adapter.normalize(oc_event("session.idle"), state)
        assert len(cc) == 0

    def test_non_text_field_deltas_ignored(self, adapter, state):
        """Deltas for non-text fields (e.g. tool state) should not accumulate text."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "state", "delta": "some state"}),
            oc_event("message.part.delta", {"field": "tool", "delta": "write"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        # No final assistant with text (only initial empty one)
        assert len(assistants) == 1
        assert assistants[0]["message"]["content"] == []

    def test_empty_delta_ignored(self, adapter, state):
        """Empty string delta should not affect accumulated text."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": ""}),
            oc_event("message.part.delta", {"field": "text", "delta": "real"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert len(final) == 1
        assert final[0]["message"]["content"][0]["text"] == "real"

    def test_non_assistant_message_updated_ignored(self, adapter, state):
        """message.updated for user role should not set msg_id."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.updated", {"info": {"role": "user", "id": "msg_user_001"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "test"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert final[0]["message"]["id"] != "msg_user_001"

    def test_message_updated_before_busy(self, adapter, state):
        """message.updated arriving before session.status busy should still track id."""
        cc = feed_sequence(adapter, state, [
            oc_event("message.updated", {"info": {"role": "assistant", "id": "msg_early"}}),
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "early bird"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        # Initial assistant should use the pre-set msg_id
        assert assistants[0]["message"]["id"] == "msg_early"
        # Final assistant should also use it
        final = [a for a in assistants if a["message"]["content"]]
        assert final[0]["message"]["id"] == "msg_early"

    def test_unknown_event_type_returns_empty(self, adapter, state):
        """Unknown event types should return empty list, not crash."""
        cc = adapter.normalize(oc_event("file.watcher.updated", {"path": "/tmp"}), state)
        assert cc == []

    def test_missing_properties_handled(self, adapter, state):
        """Events with no properties key should not crash."""
        cc = adapter.normalize({"type": "session.status"}, state)
        assert cc == []


class TestPermissionTracking:
    """Permission ID tracking in normalize state."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    @pytest.fixture
    def state(self):
        return {}

    def test_permission_tracked(self, adapter, state):
        """permission.asked should store the permission ID in state."""
        adapter.normalize(oc_event("permission.asked", {"id": "perm_001"}), state)
        assert "perm_001" in state.get("pending_permissions", {})

    def test_multiple_permissions_tracked(self, adapter, state):
        """Multiple permissions should all be tracked independently."""
        adapter.normalize(oc_event("permission.asked", {"id": "perm_001"}), state)
        adapter.normalize(oc_event("permission.asked", {"id": "perm_002"}), state)
        perms = state.get("pending_permissions", {})
        assert len(perms) == 2
        assert "perm_001" in perms
        assert "perm_002" in perms

    def test_empty_permission_id_ignored(self, adapter, state):
        """permission.asked with empty ID should not track."""
        adapter.normalize(oc_event("permission.asked", {"id": ""}), state)
        assert len(state.get("pending_permissions", {})) == 0

    def test_permission_no_id_key_ignored(self, adapter, state):
        """permission.asked without id key should not track."""
        adapter.normalize(oc_event("permission.asked", {}), state)
        assert len(state.get("pending_permissions", {})) == 0


class TestSessionIdTracking:
    """Session ID extraction from various event shapes."""

    @pytest.fixture
    def adapter(self):
        return OpenCodeAdapter()

    @pytest.fixture
    def state(self):
        return {}

    def test_session_id_from_sessionID_field(self, adapter, state):
        """sessionID in properties should be tracked."""
        adapter.normalize(
            oc_event("session.created", {"sessionID": "ses_abc123"}), state
        )
        assert state["session_id"] == "ses_abc123"

    def test_session_id_propagates_to_cc_events(self, adapter, state):
        """Tracked session ID should appear in emitted CC events."""
        cc = feed_sequence(adapter, state, [
            oc_event("session.created", {"sessionID": "ses_xyz"}),
            oc_event("session.status", {"status": {"type": "busy"}}),
            oc_event("message.part.delta", {"field": "text", "delta": "hi"}),
            oc_event("session.idle"),
        ])

        assistants = by_type(cc, "assistant")
        assert assistants[0]["session_id"] == "ses_xyz"

        results = by_type(cc, "result")
        assert results[0]["session_id"] == "ses_xyz"
