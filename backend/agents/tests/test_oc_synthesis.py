"""OpenCode CC event synthesis tests — state machine for turn tracking.

Tests the relay's _synthesize_cc_events() logic which translates OpenCode
SSE events into CC-compatible events. This is a state machine with hidden
invariants: turn start, text accumulation, turn completion, and reset.

The relay code lives in agent/opencode/rootfs/opt/abox/relay.py but the
logic is pure enough to test as a unit: given a sequence of (event_type,
props) inputs, verify the synthesized CC events sent to the backend.

We don't import from the agent image (different Python env). Instead we
replicate the state machine logic as a test double and verify the contract
that the relay must satisfy. If the relay's synthesis drifts from these
expectations, either the tests or the relay is wrong — investigate.
"""

import pytest


class FakeSender:
    """Captures events sent by the synthesis state machine."""

    def __init__(self):
        self.events: list[dict] = []

    async def send(self, event: dict):
        self.events.append(event)

    def by_type(self, event_type: str) -> list[dict]:
        return [e for e in self.events if e.get("type") == event_type]

    def reset(self):
        self.events.clear()


class SynthesisStateMachine:
    """Test double of relay.py's _synthesize_cc_events state machine.

    Extracted from agent/opencode/rootfs/opt/abox/relay.py:294-377.
    Kept in sync manually — if the relay changes, these tests must too.
    """

    def __init__(self, sender: FakeSender, session_id: str = "ses_test"):
        self._sender = sender
        self.session_id = session_id
        self._turn_msg_id: str = ""
        self._turn_text: str = ""
        self._turn_started: bool = False
        self._turn_start_time: float = 0.0
        self._pending_permissions: dict[str, str] = {}
        self._time_counter: float = 1000.0  # deterministic fake time

    def _now(self) -> float:
        return self._time_counter

    async def synthesize(self, event_type: str, props: dict):
        if event_type == "session.status":
            status_type = props.get("status", {}).get("type", "")
            if status_type == "busy" and not self._turn_started:
                self._turn_started = True
                self._turn_start_time = self._now()
                self._turn_text = ""
                cc_event = {
                    "type": "assistant",
                    "message": {
                        "id": self._turn_msg_id or f"oc_turn_fallback",
                        "role": "assistant",
                        "content": [],
                    },
                    "session_id": self.session_id,
                }
                await self._sender.send(cc_event)

        elif event_type == "message.updated":
            info = props.get("info", {})
            if isinstance(info, dict) and info.get("role") == "assistant":
                msg_id = info.get("id", "")
                if msg_id:
                    self._turn_msg_id = msg_id

        elif event_type == "message.part.delta":
            if props.get("field") == "text":
                delta = props.get("delta", "")
                if delta:
                    self._turn_text += delta

        elif event_type == "session.idle":
            if self._turn_started:
                elapsed_ms = int((self._now() - self._turn_start_time) * 1000)

                if self._turn_text:
                    cc_assistant = {
                        "type": "assistant",
                        "message": {
                            "id": self._turn_msg_id or "oc_turn_fallback",
                            "role": "assistant",
                            "content": [{"type": "text", "text": self._turn_text}],
                        },
                        "session_id": self.session_id,
                    }
                    await self._sender.send(cc_assistant)

                cc_result = {
                    "type": "result",
                    "session_id": self.session_id,
                    "is_error": False,
                    "total_cost_usd": 0,
                    "duration_ms": elapsed_ms,
                    "duration_api_ms": elapsed_ms,
                    "num_turns": 1,
                }
                await self._sender.send(cc_result)

                self._turn_started = False
                self._turn_msg_id = ""
                self._turn_text = ""
                self._turn_start_time = 0.0

        elif event_type == "permission.asked":
            perm_id = props.get("id", "")
            if perm_id:
                self._pending_permissions[perm_id] = perm_id

    def advance_time(self, seconds: float):
        self._time_counter += seconds


# ── Test helpers ──

async def run_sequence(sm: SynthesisStateMachine, events: list[tuple[str, dict]]):
    """Feed a sequence of (event_type, props) through the state machine."""
    for event_type, props in events:
        await sm.synthesize(event_type, props)


# ── Tests ──


class TestTurnLifecycle:
    """Core turn lifecycle: busy → deltas → idle → events emitted."""

    @pytest.fixture
    def sender(self):
        return FakeSender()

    @pytest.fixture
    def sm(self, sender):
        return SynthesisStateMachine(sender)

    @pytest.mark.asyncio
    async def test_basic_turn(self, sm, sender):
        """busy → text deltas → idle produces assistant + result events."""
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.updated", {"info": {"role": "assistant", "id": "msg_001"}}),
            ("message.part.delta", {"field": "text", "delta": "hello "}),
            ("message.part.delta", {"field": "text", "delta": "world"}),
        ])
        sm.advance_time(2.5)
        await sm.synthesize("session.idle", {})

        # Should have: initial assistant (empty), final assistant (with text), result
        assistants = sender.by_type("assistant")
        results = sender.by_type("result")

        assert len(assistants) == 2
        assert len(results) == 1

        # Initial assistant has empty content (triggers RUNNING)
        assert assistants[0]["message"]["content"] == []

        # Final assistant has accumulated text
        assert assistants[1]["message"]["content"] == [
            {"type": "text", "text": "hello world"}
        ]
        assert assistants[1]["message"]["id"] == "msg_001"

        # Result has duration
        assert results[0]["is_error"] is False
        assert results[0]["num_turns"] == 1
        assert results[0]["session_id"] == "ses_test"

    @pytest.mark.asyncio
    async def test_turn_without_text(self, sm, sender):
        """busy → idle with no text deltas — result emitted, no final assistant."""
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
        ])
        sm.advance_time(1.0)
        await sm.synthesize("session.idle", {})

        assistants = sender.by_type("assistant")
        results = sender.by_type("result")

        # Only initial assistant (no final one since no text)
        assert len(assistants) == 1
        assert assistants[0]["message"]["content"] == []

        # Result still emitted
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_multiple_turns(self, sm, sender):
        """Two consecutive turns produce independent event sets."""
        # Turn 1
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.updated", {"info": {"role": "assistant", "id": "msg_001"}}),
            ("message.part.delta", {"field": "text", "delta": "first"}),
        ])
        sm.advance_time(1.0)
        await sm.synthesize("session.idle", {})

        # Turn 2
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.updated", {"info": {"role": "assistant", "id": "msg_002"}}),
            ("message.part.delta", {"field": "text", "delta": "second"}),
        ])
        sm.advance_time(2.0)
        await sm.synthesize("session.idle", {})

        assistants = sender.by_type("assistant")
        results = sender.by_type("result")

        # 2 initial + 2 final = 4 assistant events
        assert len(assistants) == 4
        assert len(results) == 2

        # Turn 1 text
        assert assistants[1]["message"]["content"][0]["text"] == "first"
        assert assistants[1]["message"]["id"] == "msg_001"

        # Turn 2 text — must NOT contain turn 1 text (state was reset)
        assert assistants[3]["message"]["content"][0]["text"] == "second"
        assert assistants[3]["message"]["id"] == "msg_002"


class TestStateReset:
    """Verify state resets correctly between turns."""

    @pytest.fixture
    def sender(self):
        return FakeSender()

    @pytest.fixture
    def sm(self, sender):
        return SynthesisStateMachine(sender)

    @pytest.mark.asyncio
    async def test_text_doesnt_leak_between_turns(self, sm, sender):
        """Text from turn 1 must not appear in turn 2."""
        # Turn 1
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.part.delta", {"field": "text", "delta": "leak_test"}),
        ])
        await sm.synthesize("session.idle", {})

        # Turn 2 with different text
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.part.delta", {"field": "text", "delta": "clean"}),
        ])
        await sm.synthesize("session.idle", {})

        assistants = sender.by_type("assistant")
        # Last assistant event should be turn 2's final
        final = assistants[-1]
        assert final["message"]["content"][0]["text"] == "clean"
        assert "leak_test" not in final["message"]["content"][0]["text"]

    @pytest.mark.asyncio
    async def test_msg_id_doesnt_leak_between_turns(self, sm, sender):
        """Message ID from turn 1 must not appear in turn 2 if not set."""
        # Turn 1 with explicit msg_id
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.updated", {"info": {"role": "assistant", "id": "msg_turn1"}}),
            ("message.part.delta", {"field": "text", "delta": "t1"}),
        ])
        await sm.synthesize("session.idle", {})

        # Turn 2 without message.updated
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.part.delta", {"field": "text", "delta": "t2"}),
        ])
        await sm.synthesize("session.idle", {})

        assistants = sender.by_type("assistant")
        # Turn 2's final assistant should use fallback ID, not turn 1's
        turn2_final = assistants[-1]
        assert turn2_final["message"]["id"] != "msg_turn1"


class TestEdgeCases:
    """Edge cases and non-obvious behaviors."""

    @pytest.fixture
    def sender(self):
        return FakeSender()

    @pytest.fixture
    def sm(self, sender):
        return SynthesisStateMachine(sender)

    @pytest.mark.asyncio
    async def test_duplicate_busy_ignored(self, sm, sender):
        """Multiple busy events without idle should not create multiple starts."""
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("session.status", {"status": {"type": "busy"}}),
            ("session.status", {"status": {"type": "busy"}}),
            ("message.part.delta", {"field": "text", "delta": "hi"}),
        ])
        await sm.synthesize("session.idle", {})

        # Only one initial assistant event despite 3 busy signals
        assistants = sender.by_type("assistant")
        initial = [a for a in assistants if a["message"]["content"] == []]
        assert len(initial) == 1

    @pytest.mark.asyncio
    async def test_idle_without_busy_is_noop(self, sm, sender):
        """Idle event without preceding busy should not emit anything."""
        await sm.synthesize("session.idle", {})
        assert len(sender.events) == 0

    @pytest.mark.asyncio
    async def test_non_text_field_deltas_ignored(self, sm, sender):
        """Deltas for non-text fields (e.g. tool state) should not accumulate text."""
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.part.delta", {"field": "state", "delta": "some state"}),
            ("message.part.delta", {"field": "tool", "delta": "write"}),
        ])
        await sm.synthesize("session.idle", {})

        assistants = sender.by_type("assistant")
        # No final assistant with text (only initial empty one)
        assert len(assistants) == 1
        assert assistants[0]["message"]["content"] == []

    @pytest.mark.asyncio
    async def test_empty_delta_ignored(self, sm, sender):
        """Empty string delta should not affect accumulated text."""
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.part.delta", {"field": "text", "delta": ""}),
            ("message.part.delta", {"field": "text", "delta": "real"}),
        ])
        await sm.synthesize("session.idle", {})

        assistants = sender.by_type("assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert len(final) == 1
        assert final[0]["message"]["content"][0]["text"] == "real"

    @pytest.mark.asyncio
    async def test_non_assistant_message_updated_ignored(self, sm, sender):
        """message.updated for user role should not set msg_id."""
        await run_sequence(sm, [
            ("session.status", {"status": {"type": "busy"}}),
            ("message.updated", {"info": {"role": "user", "id": "msg_user_001"}}),
            ("message.part.delta", {"field": "text", "delta": "test"}),
        ])
        await sm.synthesize("session.idle", {})

        assistants = sender.by_type("assistant")
        final = [a for a in assistants if a["message"]["content"]]
        assert final[0]["message"]["id"] != "msg_user_001"

    @pytest.mark.asyncio
    async def test_message_updated_before_busy(self, sm, sender):
        """message.updated arriving before session.status busy should still track id."""
        await run_sequence(sm, [
            ("message.updated", {"info": {"role": "assistant", "id": "msg_early"}}),
            ("session.status", {"status": {"type": "busy"}}),
            ("message.part.delta", {"field": "text", "delta": "early bird"}),
        ])
        await sm.synthesize("session.idle", {})

        assistants = sender.by_type("assistant")
        # Initial assistant should use the pre-set msg_id
        assert assistants[0]["message"]["id"] == "msg_early"
        # Final assistant should also use it
        final = [a for a in assistants if a["message"]["content"]]
        assert final[0]["message"]["id"] == "msg_early"


class TestPermissionTracking:
    """Permission ID tracking for callback resolution."""

    @pytest.fixture
    def sender(self):
        return FakeSender()

    @pytest.fixture
    def sm(self, sender):
        return SynthesisStateMachine(sender)

    @pytest.mark.asyncio
    async def test_permission_tracked(self, sm, sender):
        """permission.asked should store the permission ID."""
        await sm.synthesize("permission.asked", {"id": "perm_001"})
        assert "perm_001" in sm._pending_permissions

    @pytest.mark.asyncio
    async def test_multiple_permissions_tracked(self, sm, sender):
        """Multiple permissions should all be tracked independently."""
        await sm.synthesize("permission.asked", {"id": "perm_001"})
        await sm.synthesize("permission.asked", {"id": "perm_002"})
        assert len(sm._pending_permissions) == 2
        assert "perm_001" in sm._pending_permissions
        assert "perm_002" in sm._pending_permissions

    @pytest.mark.asyncio
    async def test_empty_permission_id_ignored(self, sm, sender):
        """permission.asked with empty ID should not track."""
        await sm.synthesize("permission.asked", {"id": ""})
        assert len(sm._pending_permissions) == 0

    @pytest.mark.asyncio
    async def test_permission_no_id_key_ignored(self, sm, sender):
        """permission.asked without id key should not track."""
        await sm.synthesize("permission.asked", {})
        assert len(sm._pending_permissions) == 0
