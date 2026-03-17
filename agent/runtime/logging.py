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
    "profile": "",
    "agent_id": "",
    "image_ref": "",
    "git_commit": "",
}


def configure_logging_context(
    *,
    mode: str = "",
    platform: str = "",
    profile: str = "",
    agent_id: str = "",
    image_ref: str = "",
    git_commit: str = "",
) -> None:
    with _context_lock:
        _context["mode"] = mode
        _context["platform"] = platform
        _context["profile"] = profile
        _context["agent_id"] = agent_id
        _context["image_ref"] = image_ref
        _context["git_commit"] = git_commit


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
        "profile": context["profile"],
        "agent_id": context["agent_id"],
        "image_ref": context["image_ref"],
        "git_commit": context["git_commit"],
        **fields,
    }
    sys.stderr.write(json.dumps(payload, sort_keys=True) + "\n")
    sys.stderr.flush()
