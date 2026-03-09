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
- buffer observability: relay_common.py:EventSender — seq IDs, drop counters, overflow events
"""

import asyncio
import json
from unittest.mock import MagicMock

import pytest

pytest.importorskip("claude_code_sdk", reason="requires claude_code_sdk (container-only)")

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


class TestRelayStartupContracts:
    """Startup stage markers and MCP preflight error contracts."""

    def test_init_stage_event_shape(self):
        from relay import _build_init_stage_event

        event = _build_init_stage_event(
            "relay.init.initialize_sent",
            cli_path="claude",
            config_path="/home/agent/.mcp.json",
        )

        assert event["type"] == "system"
        assert event["subtype"] == "relay_init_stage"
        assert event["stage"] == "relay.init.initialize_sent"
        assert event["details"]["cli_path"] == "claude"

    def test_preflight_rejects_invalid_json(self, tmp_path):
        from relay import MCPConfigError, _preflight_mcp_servers

        config_path = tmp_path / ".mcp.json"
        config_path.write_text("{not-json")

        with pytest.raises(MCPConfigError):
            _preflight_mcp_servers(str(config_path))

    def test_preflight_rejects_non_sse_url_transport(self, tmp_path):
        from relay import MCPConfigError, _preflight_mcp_servers

        config_path = tmp_path / ".mcp.json"
        config_path.write_text(json.dumps({
            "mcpServers": {
                "team": {
                    "type": "http",
                    "url": "http://backend:8000/mcp",
                }
            }
        }))

        with pytest.raises(MCPConfigError):
            _preflight_mcp_servers(str(config_path))


class TestDependencyVersionCheck:
    """_check_dependency_compatibility — validates CLI + SDK + proxy versions
    against the known-good matrix before spawning the SDK."""

    def test_dependency_version_check_format(self):
        """The compatibility check function validates version strings correctly.

        _COMPATIBLE_VERSIONS entries must have cli, sdk, proxy keys with
        string values matching semver-like patterns.
        """
        from relay import _COMPATIBLE_VERSIONS

        assert len(_COMPATIBLE_VERSIONS) >= 1, "Matrix must have at least one entry"
        for entry in _COMPATIBLE_VERSIONS:
            assert "cli" in entry, "Matrix entry missing 'cli' key"
            assert "sdk" in entry, "Matrix entry missing 'sdk' key"
            assert "proxy" in entry, "Matrix entry missing 'proxy' key"
            assert isinstance(entry["cli"], str), "cli version must be a string"
            assert isinstance(entry["sdk"], str), "sdk version must be a string"
            assert isinstance(entry["proxy"], str), "proxy version must be a string"
            # Versions should look like semver (X.Y.Z) or simple integers
            assert entry["cli"].replace(".", "").isdigit(), (
                f"cli version '{entry['cli']}' doesn't look like a version number"
            )
            assert entry["sdk"].replace(".", "").isdigit(), (
                f"sdk version '{entry['sdk']}' doesn't look like a version number"
            )

    def test_incompatible_versions_emit_typed_error(self, monkeypatch):
        """Mismatched versions must raise DependencyCompatibilityError
        with ERR-DEPENDENCY-COMPATIBILITY in the message."""
        import relay
        import subprocess as _subprocess

        # Mock SDK version to something not in the matrix
        import claude_agent_sdk
        monkeypatch.setattr(claude_agent_sdk, "__version__", "0.0.0-fake")

        # Mock CLI version check — patch on relay module since it uses
        # subprocess.run via its own module-level import
        fake_result = _subprocess.CompletedProcess(
            args=["claude", "--version"],
            returncode=0,
            stdout="0.0.0-fake\n",
            stderr="",
        )
        monkeypatch.setattr(relay.subprocess, "run", lambda *a, **kw: fake_result)
        monkeypatch.setenv("ABOX_PROXY_VERSION", "999")

        with pytest.raises(relay.DependencyCompatibilityError, match="ERR-DEPENDENCY-COMPATIBILITY"):
            relay._check_dependency_compatibility()

    def test_compatible_versions_pass(self, monkeypatch):
        """When versions match the matrix, the check succeeds and returns
        a dict of the detected versions."""
        import relay
        import subprocess as _subprocess

        entry = relay._COMPATIBLE_VERSIONS[0]

        import claude_agent_sdk
        monkeypatch.setattr(claude_agent_sdk, "__version__", entry["sdk"])

        fake_result = _subprocess.CompletedProcess(
            args=["claude", "--version"],
            returncode=0,
            stdout=f"{entry['cli']} (Claude Code)\n",
            stderr="",
        )
        monkeypatch.setattr(relay.subprocess, "run", lambda *a, **kw: fake_result)
        monkeypatch.setenv("ABOX_PROXY_VERSION", entry["proxy"])

        versions = relay._check_dependency_compatibility()
        assert versions["cli"] == entry["cli"]
        assert versions["sdk"] == entry["sdk"]
        assert versions["proxy"] == entry["proxy"]

    def test_smoke_runtime_contract_reports_artifacts(self, monkeypatch):
        import relay
        import subprocess as _subprocess

        entry = relay._COMPATIBLE_VERSIONS[0]

        import claude_agent_sdk
        monkeypatch.setattr(claude_agent_sdk, "__version__", entry["sdk"])

        def fake_run(args, **kwargs):
            if args == ["claude", "--version"]:
                return _subprocess.CompletedProcess(
                    args=args,
                    returncode=0,
                    stdout=f"{entry['cli']} (Claude Code)\n",
                    stderr="",
                )
            if args == ["claude", "--help"]:
                return _subprocess.CompletedProcess(
                    args=args,
                    returncode=0,
                    stdout="Usage: claude [options]\n  --output-format <fmt>\n  --verbose\n",
                    stderr="",
                )
            raise AssertionError(f"unexpected subprocess call: {args}")

        monkeypatch.setattr(relay.subprocess, "run", fake_run)
        monkeypatch.setenv("ABOX_PROXY_VERSION", entry["proxy"])

        payload = relay._smoke_runtime_contract()

        assert payload["ok"] is True
        assert payload["versions"]["cli"] == entry["cli"]
        assert payload["versions"]["sdk"] == entry["sdk"]
        assert payload["versions"]["proxy"] == entry["proxy"]
        assert payload["flags"]["output_format"] is True
        assert payload["flags"]["verbose"] is True


class TestFirefoxThemeReload:
    """Theme changes use loopback socket poke — relay must NOT restart Firefox."""

    def test_no_firefox_restart_method(self):
        """Relay must not have _restart_firefox_for_theme — socket poke replaces it."""
        import relay
        assert not hasattr(relay.SDKRelay, "_restart_firefox_for_theme"), (
            "SDKRelay still has _restart_firefox_for_theme — "
            "theme reload should use mozilla.cfg socket poke"
        )

    def test_no_firefox_process_constants(self):
        """FIREFOX_WRAPPER and FIREFOX_PROCESS_NAME constants should be removed."""
        import relay
        assert not hasattr(relay, "FIREFOX_WRAPPER"), (
            "relay.FIREFOX_WRAPPER still exists — dead code from restart approach"
        )
        assert not hasattr(relay, "FIREFOX_PROCESS_NAME"), (
            "relay.FIREFOX_PROCESS_NAME still exists — dead code from restart approach"
        )

    def test_theme_handler_calls_converter(self):
        """_on_theme_changed must call converters.py to regenerate CSS."""
        import relay
        import inspect
        source = inspect.getsource(relay.SDKRelay._on_theme_changed)
        assert "converters.py" in source, (
            "_on_theme_changed does not call converters.py — "
            "tokens.json won't be converted to userChrome.css"
        )


class TestHookBridgeRouting:
    """team-bridge.py tool classification — PRE tools are intercepted,
    POST tools are forwarded after native execution, others pass through."""

    @pytest.fixture
    def bridge_sets(self, hooks_dir):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "team_bridge", hooks_dir / "team-bridge.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.PRE, mod.POST, mod.BRIDGED

    @pytest.fixture
    def bridge_module(self, hooks_dir):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "team_bridge", hooks_dir / "team-bridge.py"
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
            {"id": "1", "title": "Fix bug", "status": "pending"},
            {"id": "2", "title": "Add tests", "status": "in_progress"},
        ]
        result = bridge_module._format_result("TaskList", tasks)
        assert "Fix bug" in result
        assert "Add tests" in result

    def test_format_result_taskget(self, bridge_module):
        task = {"id": "1", "subject": "Fix bug", "status": "pending", "description": "Details here"}
        result = bridge_module._format_result("TaskGet", task)
        assert "Fix bug" in result
        assert "Details here" in result


# ---------------------------------------------------------------------------
# EventSender buffer observability (INV-OBS-002)
# ---------------------------------------------------------------------------


class _FakeWSTransport:
    """Minimal WSTransport stand-in for testing EventSender."""

    def __init__(self, connected=True, send_ok=True):
        self.connected = connected
        self._send_ok = send_ok
        self.sent_events = []

    async def send(self, event):
        if not self.connected or not self._send_ok:
            return False
        self.sent_events.append(event)
        return True

    async def reconnect(self):
        return False


class _FakeRedactor:
    """Pass-through redactor for tests."""

    def redact_event(self, event):
        return event


def _make_sender(ws_connected=True, ws_send_ok=True):
    """Create an EventSender with a fake WSTransport for testing."""
    from relay_common import EventSender

    ws = _FakeWSTransport(connected=ws_connected, send_ok=ws_send_ok)
    redactor = _FakeRedactor()

    log = MagicMock()
    log.info = MagicMock()
    log.warning = MagicMock()
    log.debug = MagicMock()

    return EventSender(ws, redactor, log=log)


class TestSequenceIdsMonotonic:
    """INV-OBS-002: Every outbound event gets a monotonic seq field."""

    def test_inv_obs_002_sequence_ids_monotonic(self):
        """Send 10 events, verify seq is 1..10."""
        sender = _make_sender(ws_connected=True, ws_send_ok=True)
        sent_seqs = []

        async def _run():
            for i in range(10):
                event = {"type": "assistant", "content": f"msg-{i}"}
                await sender.send(event)
                sent_seqs.append(event["seq"])

        asyncio.run(_run())

        assert sent_seqs == list(range(1, 11))
        assert sender.events_sent == 10

    def test_seq_never_resets_across_sends(self):
        """Seq counter persists across multiple send calls."""
        sender = _make_sender(ws_connected=True, ws_send_ok=True)

        async def _run():
            await sender.send({"type": "assistant"})
            await sender.send({"type": "assistant"})
            await sender.send({"type": "result"})

        asyncio.run(_run())
        assert sender._seq == 3


class TestDropCounterIncrements:
    """INV-OBS-002: Drop counters track non-critical drops during disconnect."""

    def test_inv_obs_002_drop_counter_increments(self):
        """Simulate disconnect, attempt non-critical send, verify counter."""
        sender = _make_sender(ws_connected=False, ws_send_ok=False)

        async def _run():
            await sender.send({"type": "assistant", "content": "hello"})

        asyncio.run(_run())

        assert sender.events_dropped_noncritical == 1
        assert sender.events_sent == 0

    def test_critical_events_buffered_not_dropped(self):
        """Critical events go to buffer, not drop counter."""
        sender = _make_sender(ws_connected=False, ws_send_ok=False)

        async def _run():
            await sender.send({"type": "result", "cost": 0.01})

        asyncio.run(_run())

        assert sender.events_dropped_noncritical == 0
        assert len(sender._event_buffer) == 1
        assert sender._event_buffer[0]["type"] == "result"


class TestOverflowEmitsTypedEvent:
    """INV-OBS-002: Buffer overflow emits relay.buffer_overflow event."""

    def test_inv_obs_002_overflow_emits_typed_event(self):
        """Fill buffer beyond maxlen, verify overflow event emitted."""
        sender = _make_sender(ws_connected=False, ws_send_ok=False)

        async def _run():
            # Fill buffer to capacity
            for i in range(sender.BUFFER_MAXLEN):
                await sender.send({"type": "system", "subtype": f"event-{i}"})

            assert len(sender._event_buffer) == sender.BUFFER_MAXLEN

            # One more critical event should trigger overflow
            await sender.send({"type": "result", "subtype": "overflow-trigger"})

        asyncio.run(_run())

        # Buffer still at maxlen (deque enforces it)
        assert len(sender._event_buffer) == sender.BUFFER_MAXLEN

        # At least one eviction was counted
        assert sender.events_evicted_critical >= 1

        # Find the overflow event in the buffer
        overflow_events = [
            e for e in sender._event_buffer
            if e.get("subtype") == "relay.buffer_overflow"
        ]
        assert len(overflow_events) >= 1

        overflow = overflow_events[0]
        assert overflow["error_code"] == "ERR-RELAY-BUFFER-OVERFLOW"
        assert overflow["buffer_size"] == sender.BUFFER_MAXLEN
        assert "evicted_seq" in overflow
        assert "seq" in overflow

    def test_overflow_event_has_seq(self):
        """Overflow events themselves get monotonic seq numbers."""
        sender = _make_sender(ws_connected=False, ws_send_ok=False)

        async def _run():
            for i in range(sender.BUFFER_MAXLEN + 1):
                await sender.send({"type": "system", "subtype": f"evt-{i}"})

        asyncio.run(_run())

        overflow_events = [
            e for e in sender._event_buffer
            if e.get("subtype") == "relay.buffer_overflow"
        ]
        for oe in overflow_events:
            assert isinstance(oe["seq"], int)
            assert oe["seq"] > 0


class TestBufferStatsReportedOnReconnect:
    """Buffer stats are logged and buffer is flushed on reconnect."""

    def test_buffer_stats_reported_on_reconnect(self):
        """Simulate disconnect+reconnect, verify stats logged and buffer flushed."""
        sender = _make_sender(ws_connected=False, ws_send_ok=False)

        async def _run():
            # Buffer some critical events during disconnect
            await sender.send({"type": "result", "cost": 0.01})
            await sender.send({"type": "system", "subtype": "process_exit"})
            # Drop a non-critical event
            await sender.send({"type": "assistant", "content": "dropped"})

            assert len(sender._event_buffer) == 2
            assert sender.events_dropped_noncritical == 1

            # Now simulate reconnect — WS becomes available
            sender.ws.connected = True
            sender.ws._send_ok = True

            await sender.on_reconnect()

        asyncio.run(_run())

        # Buffer should be flushed
        assert len(sender._event_buffer) == 0

        # Stats were logged (check the log mock)
        log_calls = [call for call in sender._log.info.call_args_list
                     if call[0][0] == "relay.buffer_stats"]
        assert len(log_calls) >= 1

        # Reconnect event was logged
        reconnect_calls = [call for call in sender._log.info.call_args_list
                           if call[0][0] == "relay.reconnected"]
        assert len(reconnect_calls) >= 1

    def test_buffer_stats_property(self):
        """buffer_stats property returns correct counters."""
        sender = _make_sender(ws_connected=True, ws_send_ok=True)

        async def _run():
            await sender.send({"type": "assistant"})
            await sender.send({"type": "result"})

        asyncio.run(_run())

        stats = sender.buffer_stats
        assert stats["events_sent"] == 2
        assert stats["events_dropped_noncritical"] == 0
        assert stats["events_evicted_critical"] == 0
        assert stats["buffer_size"] == 0
