from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from threading import Lock
from typing import IO
from typing import Any


_context_lock = Lock()
_sink_lock = Lock()
_context = {
    "mode": "",
    "platform": "",
    "profile": "",
    "agent_id": "",
    "image_ref": "",
    "git_commit": "",
    "root_dir": "",
}
_file_sink: IO[str] | None = None
_file_sink_path = ""


def configure_logging_context(
    *,
    mode: str = "",
    platform: str = "",
    profile: str = "",
    agent_id: str = "",
    image_ref: str = "",
    git_commit: str = "",
    root_dir: str | Path = "",
) -> None:
    with _context_lock:
        _context["mode"] = mode
        _context["platform"] = platform
        _context["profile"] = profile
        _context["agent_id"] = agent_id
        _context["image_ref"] = image_ref
        _context["git_commit"] = git_commit
        _context["root_dir"] = os.fspath(root_dir) if root_dir else ""
    _configure_file_sink(_context["root_dir"])


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
    line = json.dumps(payload, sort_keys=True) + "\n"
    sys.stderr.write(line)
    sys.stderr.flush()
    with _sink_lock:
        if _file_sink is not None:
            _file_sink.write(line)
            _file_sink.flush()


def _configure_file_sink(root_dir: str) -> None:
    global _file_sink, _file_sink_path
    desired_path = ""
    if root_dir:
        desired_path = str(Path(root_dir) / "_abox" / "logs" / "runtime.jsonl")
    with _sink_lock:
        if desired_path == _file_sink_path:
            return
        if _file_sink is not None:
            _file_sink.close()
            _file_sink = None
            _file_sink_path = ""
        if not desired_path:
            return
        log_path = Path(desired_path)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        _file_sink = log_path.open("a", encoding="utf-8", buffering=1)
        _file_sink_path = desired_path
