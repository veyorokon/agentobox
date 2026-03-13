"""Shared JSON logging for all agent-side Python processes.

Stdlib-only (no pip dependencies). Produces JSON lines on stderr matching
the backend structlog output shape — identical field names so all logs are
greppable with the same tooling and OTEL-compatible without field remapping.

Field contract (matches backend telemetry.py):
    timestamp         ISO 8601 (e.g. "2026-03-13T12:00:00Z")
    level             "info" | "warning" | "error" | "debug" | "critical"
    logger            Logger name (e.g. "abox-relay", "svc-relay")
    event             Event name (e.g. "relay.ws_connected")
    service.name      "agentobox-agent"
    service.version   From ABOX_AGENT_VERSION env or "unknown"
    environment       From ABOX_ENVIRONMENT env or "local"
    agent_id          From AGENT_ID env
    exception.type    Fully qualified exception class (OTEL semantic convention)
    exception.message Exception message string
    exception.stacktrace Full traceback string

Usage::

    from abox_logging import setup
    log = setup("abox-relay")                 # INFO level (default)
    log = setup("team-bridge", level="DEBUG")  # DEBUG level

    log.info("relay.ws_connected")
    log.info("relay.turn_complete", extra={"received": 5, "elapsed": 1.2})
"""

import json
import logging
import os
import re
import sys
import traceback


class JSONFormatter(logging.Formatter):
    """JSON log formatter — zero dependencies, matches backend structlog output shape."""

    # Attributes that LogRecord always has — skip these when extracting extras.
    _BUILTIN = frozenset({
        "name", "msg", "args", "created", "relativeCreated", "thread",
        "threadName", "msecs", "filename", "funcName", "levelno", "lineno",
        "module", "exc_info", "exc_text", "stack_info", "pathname",
        "processName", "process", "levelname", "message", "taskName",
    })

    def format(self, record):
        entry = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.msg if isinstance(record.msg, str) else str(record.msg),
            "service.name": "agentobox-agent",
            "service.version": os.environ.get("ABOX_AGENT_VERSION", "unknown"),
            "environment": os.environ.get("ABOX_ENVIRONMENT", "local"),
            "agent_id": os.environ.get("AGENT_ID", ""),
        }
        # Merge extra kwargs from log calls into the JSON entry
        for key, val in record.__dict__.items():
            if key not in self._BUILTIN and key not in entry:
                entry[key] = val
        # OTEL semantic convention: split exception into type/message/stacktrace
        if record.exc_info and record.exc_info[0]:
            exc_type, exc_value, exc_tb = record.exc_info
            entry["exception.type"] = f"{exc_type.__module__}.{exc_type.__name__}"
            entry["exception.message"] = str(exc_value)
            entry["exception.stacktrace"] = "".join(
                traceback.format_exception(exc_type, exc_value, exc_tb)
            ).rstrip()
        return json.dumps(entry, default=str)


def _persist_logs_enabled() -> bool:
    raw = os.environ.get("ABOX_PERSIST_LOGS", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _log_dir() -> str:
    explicit = os.environ.get("ABOX_LOG_DIR", "").strip()
    if explicit:
        return explicit
    agent_id = os.environ.get("AGENT_ID", "").strip()
    if not agent_id:
        return ""
    return f"/vol/agents/{agent_id}/_abox"


def _safe_log_name(name: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip("-")
    return sanitized or "agent"


def _has_handler(root: logging.Logger, *, handler_type: type, path: str | None = None) -> bool:
    expected = os.path.abspath(path) if path else None
    for handler in root.handlers:
        if not isinstance(handler, handler_type):
            continue
        if expected is None:
            return True
        if os.path.abspath(getattr(handler, "baseFilename", "")) == expected:
            return True
    return False


class RedactingFormatter(JSONFormatter):
    """JSONFormatter that scrubs secrets from the final output line."""

    def __init__(self, redactor: "Redactor", **kwargs):
        super().__init__(**kwargs)
        self._redactor = redactor

    def format(self, record):
        line = super().format(record)
        line = self._redactor.redact(line)
        return line


def add_redacting_file_handler(name: str, redactor: "Redactor") -> None:
    """Replace any existing file handler for this log name with a redacting one.

    Call after Redactor.load() to ensure persistent log files have secrets
    scrubbed. Leaves stderr handler unredacted (ephemeral tmpfs, performance).
    """
    if not _persist_logs_enabled():
        return
    log_dir = _log_dir()
    if not log_dir:
        return
    root = logging.root
    log_path = os.path.join(log_dir, f"{_safe_log_name(name)}.log")
    abs_path = os.path.abspath(log_path)
    # Remove existing plain file handler for this path
    for h in root.handlers[:]:
        if isinstance(h, logging.FileHandler) and os.path.abspath(
            getattr(h, "baseFilename", "")
        ) == abs_path:
            root.removeHandler(h)
            h.close()
            break
    try:
        os.makedirs(log_dir, exist_ok=True)
        fmt = RedactingFormatter(redactor, datefmt="%Y-%m-%dT%H:%M:%SZ")
        fh = logging.FileHandler(log_path)
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        pass


def setup(name: str, *, level: str = "INFO") -> logging.Logger:
    """Configure the root logger with JSON output and return a named logger.

    Safe to call multiple times — only attaches the handler once.
    """
    root = logging.root
    formatter = JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ")

    if not any(isinstance(h.formatter, JSONFormatter) for h in root.handlers):
        stderr_handler = logging.StreamHandler(sys.stderr)
        stderr_handler.setFormatter(formatter)
        root.addHandler(stderr_handler)

    if _persist_logs_enabled():
        log_dir = _log_dir()
        if log_dir:
            try:
                os.makedirs(log_dir, exist_ok=True)
                log_path = os.path.join(log_dir, f"{_safe_log_name(name)}.log")
                if not _has_handler(root, handler_type=logging.FileHandler, path=log_path):
                    file_handler = logging.FileHandler(log_path)
                    file_handler.setFormatter(formatter)
                    root.addHandler(file_handler)
            except OSError:
                # Logging must never fail the process startup path.
                pass

    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    return logging.getLogger(name)


def setup_redacted_logging(name: str, *, level: str = "INFO") -> "tuple[logging.Logger, Redactor]":
    """Setup logging + attach a redacting file handler.

    Convenience wrapper: calls setup(), creates a Redactor, loads secrets,
    and wires the redacting file handler. Returns (logger, redactor).
    """
    from relay_common import Redactor

    log = setup(name, level=level)
    redactor = Redactor(log=log)
    redactor.load()
    add_redacting_file_handler(name, redactor)
    return log, redactor
