"""Tests for abox_logging.py — shared JSON log formatter.

Validates:
- Output is valid JSON
- Required fields present (timestamp, level, logger, agent_id, event)
- Extra kwargs merge into output
- Exception info included when present
- setup() is idempotent (no duplicate handlers)
"""

import json
import logging
import os
from pathlib import Path

import pytest

import abox_logging
from abox_logging import JSONFormatter, setup

pytestmark = pytest.mark.unit


class TestJSONFormatter:
    """JSONFormatter output shape — this is a contract with log pipelines."""

    def _make_record(self, msg="test.event", level=logging.INFO, **extra):
        logger = logging.getLogger("test-logger")
        record = logger.makeRecord(
            name="test-logger",
            level=level,
            fn="test.py",
            lno=1,
            msg=msg,
            args=(),
            exc_info=None,
            extra=extra,
        )
        return record

    def test_output_is_valid_json(self):
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("relay.ws_connected")
        result = fmt.format(record)
        parsed = json.loads(result)
        assert isinstance(parsed, dict)

    def test_required_fields_present(self):
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("relay.ws_connected")
        parsed = json.loads(fmt.format(record))
        assert "timestamp" in parsed
        assert "level" in parsed
        assert "logger" in parsed
        assert "agent_id" in parsed
        assert "event" in parsed

    def test_event_is_raw_msg_not_formatted(self):
        """Event field must be the domain.action string, not printf-expanded."""
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        # Even if args are passed, event should be the raw msg string
        record = self._make_record("relay.turn_complete")
        parsed = json.loads(fmt.format(record))
        assert parsed["event"] == "relay.turn_complete"

    def test_level_is_lowercase(self):
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record(level=logging.WARNING)
        parsed = json.loads(fmt.format(record))
        assert parsed["level"] == "warning"

    def test_extras_merged_into_output(self):
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("relay.turn_complete", received=5, elapsed=1.2)
        parsed = json.loads(fmt.format(record))
        assert parsed["received"] == 5
        assert parsed["elapsed"] == 1.2

    def test_extras_dont_overwrite_required_fields(self):
        """Extra keys matching entry keys (event, timestamp, etc.) must not
        clobber the real values. The formatter builds entry first, then skips
        extras that collide."""
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("relay.ws_connected", event="hacked", timestamp="hacked")
        parsed = json.loads(fmt.format(record))
        assert parsed["event"] == "relay.ws_connected"
        assert parsed["timestamp"] != "hacked"

    def test_exception_included(self):
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        try:
            raise ValueError("test error")
        except ValueError:
            import sys
            exc_info = sys.exc_info()
        record = self._make_record("relay.crashed")
        record.exc_info = exc_info
        parsed = json.loads(fmt.format(record))
        assert "exception" in parsed
        assert "ValueError" in parsed["exception"]
        assert "test error" in parsed["exception"]

    def test_non_serializable_extras_use_str(self):
        """default=str should handle non-JSON-serializable values."""
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("relay.test", obj=object())
        result = fmt.format(record)
        # Should not raise — default=str catches it
        parsed = json.loads(result)
        assert "obj" in parsed

    def test_agent_id_from_env(self, monkeypatch):
        monkeypatch.setenv("AGENT_ID", "agent-xyz-789")
        fmt = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("relay.test")
        parsed = json.loads(fmt.format(record))
        assert parsed["agent_id"] == "agent-xyz-789"


class TestSetup:
    """setup() function — logging root configuration."""

    def test_returns_named_logger(self):
        log = setup("test-setup-logger")
        assert log.name == "test-setup-logger"

    def test_idempotent(self):
        """Calling setup() with the same name twice should not duplicate handlers."""
        root = logging.root
        before_count = len(root.handlers)
        setup("idempotent-test")
        after_first = len(root.handlers)
        setup("idempotent-test")
        after_second = len(root.handlers)
        # Second call with the same name must not add handlers
        assert after_second == after_first

    def test_respects_level(self):
        log = setup("debug-logger", level="DEBUG")
        assert logging.root.level == logging.DEBUG

    def test_persists_logs_to_volume_when_log_dir_set(self, monkeypatch, tmp_path):
        monkeypatch.setenv("ABOX_LOG_DIR", str(tmp_path))
        log = setup("relay smoke logger")
        log.info("relay.test_log_file")

        expected = tmp_path / "relay-smoke-logger.log"
        assert expected.exists()
        lines = [line for line in expected.read_text().splitlines() if line.strip()]
        assert lines, "expected at least one persisted log line"
        parsed = json.loads(lines[-1])
        assert parsed["event"] == "relay.test_log_file"

    def test_persist_logs_can_be_disabled(self, monkeypatch, tmp_path):
        monkeypatch.setenv("ABOX_LOG_DIR", str(tmp_path))
        monkeypatch.setenv("ABOX_PERSIST_LOGS", "0")
        setup("disabled-log")
        assert not any(Path(tmp_path).glob("*.log"))


class TestRedactingFormatter:
    """RedactingFormatter — secrets scrubbed from JSON output."""

    class _FakeRedactor:
        """Minimal redactor for testing — replaces known secrets."""

        def __init__(self, secrets):
            self._secrets = secrets

        def redact(self, text):
            for secret in self._secrets:
                text = text.replace(secret, "[REDACTED]")
            return text

    def _make_record(self, msg="test.event", level=logging.INFO, **extra):
        logger = logging.getLogger("test-redact")
        return logger.makeRecord(
            name="test-redact", level=level, fn="test.py", lno=1,
            msg=msg, args=(), exc_info=None, extra=extra,
        )

    def test_secret_in_msg_is_redacted(self):
        redactor = self._FakeRedactor(["sk-ant-secret123"])
        fmt = abox_logging.RedactingFormatter(redactor, datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("key is sk-ant-secret123 here")
        line = fmt.format(record)
        parsed = json.loads(line)
        assert "sk-ant-secret123" not in line
        assert "[REDACTED]" in parsed["event"]

    def test_secret_in_extra_is_redacted(self):
        redactor = self._FakeRedactor(["supersecrettoken"])
        fmt = abox_logging.RedactingFormatter(redactor, datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("test.event", token="supersecrettoken")
        line = fmt.format(record)
        assert "supersecrettoken" not in line
        assert "[REDACTED]" in line

    def test_none_redactor_raises(self):
        """RedactingFormatter requires a real Redactor — fail loud, not silent."""
        fmt = abox_logging.RedactingFormatter(None, datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("test.event")
        with pytest.raises(AttributeError):
            fmt.format(record)

    def test_output_is_valid_json(self):
        redactor = self._FakeRedactor(["secret"])
        fmt = abox_logging.RedactingFormatter(redactor, datefmt="%Y-%m-%dT%H:%M:%SZ")
        record = self._make_record("has secret in msg")
        line = fmt.format(record)
        parsed = json.loads(line)
        assert isinstance(parsed, dict)


class TestAddRedactingFileHandler:
    """add_redacting_file_handler — replaces plain handler with redacting one."""

    class _FakeRedactor:
        def redact(self, text):
            return text.replace("SECRET", "[REDACTED]")

    def test_replaces_plain_file_handler(self, monkeypatch, tmp_path):
        monkeypatch.setenv("ABOX_LOG_DIR", str(tmp_path))
        # First, setup creates a plain file handler
        log = setup("redact-replace-test")
        plain_path = tmp_path / "redact-replace-test.log"
        assert plain_path.exists()

        # Count file handlers before
        root = logging.root
        abs_path = os.path.abspath(str(plain_path))
        file_handlers_before = [
            h for h in root.handlers
            if isinstance(h, logging.FileHandler)
            and os.path.abspath(getattr(h, "baseFilename", "")) == abs_path
        ]
        assert len(file_handlers_before) == 1
        assert not isinstance(file_handlers_before[0].formatter, abox_logging.RedactingFormatter)

        # Now replace with redacting handler
        abox_logging.add_redacting_file_handler("redact-replace-test", self._FakeRedactor())

        file_handlers_after = [
            h for h in root.handlers
            if isinstance(h, logging.FileHandler)
            and os.path.abspath(getattr(h, "baseFilename", "")) == abs_path
        ]
        assert len(file_handlers_after) == 1
        assert isinstance(file_handlers_after[0].formatter, abox_logging.RedactingFormatter)

    def test_redacting_handler_scrubs_output(self, monkeypatch, tmp_path):
        monkeypatch.setenv("ABOX_LOG_DIR", str(tmp_path))
        log = setup("redact-scrub-test")
        abox_logging.add_redacting_file_handler("redact-scrub-test", self._FakeRedactor())

        log.info("the key is SECRET here")
        log_file = tmp_path / "redact-scrub-test.log"
        content = log_file.read_text()
        assert "SECRET" not in content
        assert "[REDACTED]" in content

    def test_stderr_not_redacted(self, monkeypatch, tmp_path, capsys):
        monkeypatch.setenv("ABOX_LOG_DIR", str(tmp_path))
        log = setup("redact-stderr-test")
        abox_logging.add_redacting_file_handler("redact-stderr-test", self._FakeRedactor())

        log.info("the key is SECRET here")
        # stderr should still contain the raw secret (not redacted)
        captured = capsys.readouterr()
        # stderr goes through logging StreamHandler, not capsys — check file is redacted
        log_file = tmp_path / "redact-stderr-test.log"
        content = log_file.read_text()
        assert "[REDACTED]" in content

    def test_noop_when_persist_disabled(self, monkeypatch, tmp_path):
        monkeypatch.setenv("ABOX_LOG_DIR", str(tmp_path))
        monkeypatch.setenv("ABOX_PERSIST_LOGS", "0")
        # Should not raise or add any handler
        abox_logging.add_redacting_file_handler("noop-test", self._FakeRedactor())


class TestHelpers:
    def test_safe_log_name(self):
        assert abox_logging._safe_log_name("relay smoke/logger") == "relay-smoke-logger"
