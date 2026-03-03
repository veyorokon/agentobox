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


def setup(name: str, *, level: str = "INFO") -> logging.Logger:
    """Configure the root logger with JSON output and return a named logger.

    Safe to call multiple times — only attaches the handler once.
    """
    root = logging.root
    if not any(isinstance(h.formatter, JSONFormatter) for h in root.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(JSONFormatter(datefmt="%Y-%m-%dT%H:%M:%SZ"))
        root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    return logging.getLogger(name)
