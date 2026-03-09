"""Shared JSON logging for all agent-side Python processes.

Stdlib-only (no pip dependencies). Produces JSON lines on stderr matching
the backend structlog output shape so all logs are greppable with the same
tooling. Each process calls ``setup()`` once at import time to configure
the root logger.

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
            "agent_id": os.environ.get("AGENT_ID", ""),
            "event": record.msg if isinstance(record.msg, str) else str(record.msg),
        }
        # Merge extra kwargs from log calls into the JSON entry
        for key, val in record.__dict__.items():
            if key not in self._BUILTIN and key not in entry:
                entry[key] = val
        if record.exc_info and record.exc_info[0]:
            entry["exception"] = self.formatException(record.exc_info)
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
