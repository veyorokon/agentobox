from __future__ import annotations

import json
import sys
import time
from threading import Lock
from typing import Any


_context_lock = Lock()
_context = {
    "mode": "",
    "platform": "",
    "agent_id": "",
}


def configure_logging_context(*, mode: str = "", platform: str = "", agent_id: str = "") -> None:
    with _context_lock:
        _context["mode"] = mode
        _context["platform"] = platform
        _context["agent_id"] = agent_id


def current_logging_context() -> dict[str, str]:
    with _context_lock:
        return dict(_context)


def emit_event(event: str, **fields: Any) -> None:
    context = current_logging_context()
    payload = {
        "ts": round(time.time(), 3),
        "event": event,
        "service.name": "agentobox-agent",
        "mode": context["mode"],
        "platform": context["platform"],
        "agent_id": context["agent_id"],
        **fields,
    }
    sys.stderr.write(json.dumps(payload, sort_keys=True) + "\n")
    sys.stderr.flush()
