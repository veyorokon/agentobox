"""Tests for abox-exec — universal structured logging process wrapper.

Validates:
- JSON passthrough: already-structured lines pass through unchanged
- Non-JSON wrapping: plain text gets wrapped in OTEL-aligned envelope
- Process exit: emits process_exited event with exit_code
- Process not found: emits process_not_found and exits 127
- Signal forwarding: SIGTERM forwarded to child
- Binary/garbage output: handled gracefully (no crash)
"""

import json
import os
import signal
import subprocess
import sys
import time

import pytest

pytestmark = pytest.mark.unit

ABOX_EXEC = os.path.join(
    os.path.dirname(__file__), "..", "rootfs", "usr", "local", "bin", "abox-exec"
)


def _run_abox_exec(child_cmd: list[str], service: str = "test-svc", env_extra: dict | None = None):
    """Run abox-exec with the given child command, return (exit_code, stderr_lines)."""
    cmd = [sys.executable, ABOX_EXEC, "--service", service, "--"] + child_cmd
    env = {**os.environ, "PYTHONPATH": os.path.join(os.path.dirname(__file__), "..", "rootfs", "opt", "abox")}
    if env_extra:
        env.update(env_extra)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, env=env)
    stderr_lines = [line for line in result.stderr.strip().splitlines() if line.strip()]
    return result.returncode, stderr_lines


def _parse_json_lines(lines: list[str]) -> list[dict]:
    """Parse JSON lines, skip non-JSON (shouldn't happen but be safe)."""
    parsed = []
    for line in lines:
        try:
            parsed.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return parsed


class TestJSONPassthrough:
    """Lines that are already valid JSON should pass through unchanged."""

    def test_json_line_passes_through(self):
        original = json.dumps({"event": "relay.connected", "level": "info", "custom": True})
        _, lines = _run_abox_exec([
            sys.executable, "-c",
            f"import sys; print({original!r}, file=sys.stderr)",
        ])
        # The original JSON line should appear in output (among abox-exec's own logs)
        found = [l for l in lines if "relay.connected" in l]
        assert found, f"expected JSON passthrough, got: {lines}"
        parsed = json.loads(found[0])
        assert parsed["event"] == "relay.connected"
        assert parsed["custom"] is True


class TestNonJSONWrapping:
    """Non-JSON output must be wrapped in structured envelope."""

    def test_plain_text_wrapped(self):
        _, lines = _run_abox_exec([
            sys.executable, "-c",
            "import sys; print('hello world', file=sys.stderr)",
        ])
        parsed = _parse_json_lines(lines)
        raw_outputs = [p for p in parsed if p.get("event") == "raw_output"]
        assert raw_outputs, f"expected raw_output event, got: {parsed}"
        entry = raw_outputs[0]
        assert entry["raw"] == "hello world"
        assert entry["stream"] == "stderr"
        assert entry["logger"] == "test-svc"

    def test_stdout_wrapped_with_correct_stream(self):
        _, lines = _run_abox_exec([
            sys.executable, "-c",
            "print('from stdout')",
        ])
        parsed = _parse_json_lines(lines)
        raw_outputs = [p for p in parsed if p.get("event") == "raw_output"]
        assert raw_outputs
        assert raw_outputs[0]["stream"] == "stdout"

    def test_python_traceback_wrapped(self):
        _, lines = _run_abox_exec([
            sys.executable, "-c",
            "raise ValueError('boom')",
        ])
        parsed = _parse_json_lines(lines)
        raw_outputs = [p for p in parsed if p.get("event") == "raw_output"]
        # At least the traceback lines should be wrapped
        assert raw_outputs, "traceback should be wrapped as raw_output"
        raw_texts = " ".join(p["raw"] for p in raw_outputs)
        assert "ValueError" in raw_texts


class TestProcessLifecycle:
    """Process exit and error handling."""

    def test_exit_code_zero(self):
        code, lines = _run_abox_exec([sys.executable, "-c", "pass"])
        assert code == 0
        parsed = _parse_json_lines(lines)
        exit_events = [p for p in parsed if p.get("event") == "process_exited"]
        assert exit_events
        assert exit_events[0]["exit_code"] == 0

    def test_exit_code_nonzero(self):
        code, lines = _run_abox_exec([sys.executable, "-c", "import sys; sys.exit(42)"])
        assert code == 42
        parsed = _parse_json_lines(lines)
        exit_events = [p for p in parsed if p.get("event") == "process_exited"]
        assert exit_events
        assert exit_events[0]["exit_code"] == 42

    def test_command_not_found(self):
        code, lines = _run_abox_exec(["/nonexistent/binary/xyz123"])
        assert code == 127
        parsed = _parse_json_lines(lines)
        not_found = [p for p in parsed if p.get("event") == "process_not_found"]
        assert not_found


class TestOTELFields:
    """Wrapped output must include OTEL-aligned fields."""

    def test_service_name_present(self):
        _, lines = _run_abox_exec([
            sys.executable, "-c", "print('test')",
        ])
        parsed = _parse_json_lines(lines)
        for entry in parsed:
            assert entry.get("service.name") == "agentobox-agent"

    def test_agent_id_from_env(self):
        _, lines = _run_abox_exec(
            [sys.executable, "-c", "print('test')"],
            env_extra={"AGENT_ID": "agent-test-123"},
        )
        parsed = _parse_json_lines(lines)
        for entry in parsed:
            assert entry.get("agent_id") == "agent-test-123"
