#!/usr/bin/env python3
"""Hook bridge: intercept CC native team tools, route through agentobox backend.

PreToolUse: read-only tools (TaskList, TaskGet) — deny native execution,
    return backend result via systemMessage.
PostToolUse: mutating tools (SendMessage, TaskCreate, TaskUpdate) — native
    tool already ran, forward to backend for DB persistence.

Stdlib only — no pip dependencies. Runs inside agent container as child of
CC process. Reads config from ~/.relay_env (CC strips custom env vars from
hook subprocesses so we cannot rely on env var inheritance).
"""

import json
import logging
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from abox_logging import setup as _setup_logging

# CC captures hook stderr — also write to a file for container-level visibility
log = _setup_logging("team-bridge", level="DEBUG")
_file_handler = logging.FileHandler("/tmp/team-bridge.log")
_file_handler.setFormatter(log.root.handlers[0].formatter if log.root.handlers else logging.Formatter())
logging.root.addHandler(_file_handler)

# Structure is the grouping — no per-tool "phase" attribute needed.
PRE = {"TaskList", "TaskGet"}
POST = {"SendMessage", "TaskCreate", "TaskUpdate"}
BRIDGED = PRE | POST


def _format_result(tool_name, payload):
    """Format backend result as clean text for systemMessage."""
    if tool_name == "TaskList" and isinstance(payload, list):
        if not payload:
            return "[agentobox] TaskList: No tasks."
        lines = []
        for t in payload:
            status = t.get("status", "")
            tid = t.get("id", "")
            subject = t.get("subject", "")
            owner = t.get("owner", "")
            blocked = t.get("blocked_by", [])
            parts = [f"[{status}] {tid}: {subject}"]
            if owner:
                parts.append(f"owner={owner}")
            if blocked:
                parts.append(f"blockedBy={blocked}")
            lines.append(" | ".join(parts))
        return "[agentobox] TaskList:\n" + "\n".join(lines)

    if tool_name == "TaskGet" and isinstance(payload, dict):
        lines = [f"  {k}: {v}" for k, v in payload.items()]
        return "[agentobox] TaskGet:\n" + "\n".join(lines)

    return f"[agentobox] {tool_name} result: {json.dumps(payload)}"


def _load_relay_env():
    """Read config from .relay_env file.

    CC hook subprocesses do NOT inherit the relay's environment variables —
    the CLI sanitizes the env for child processes. So we read the values
    directly from the provisioned .relay_env file instead.
    # tech-debt: if CC ever exposes hook env passthrough, simplify to os.environ reads
    """
    env_file = "/home/agent/.relay_env"
    result = {}
    try:
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line.startswith("export ") and "=" in line:
                    # "export KEY=VALUE" or "export KEY='VALUE'"
                    rest = line[len("export "):]
                    key, _, val = rest.partition("=")
                    # Strip surrounding quotes
                    val = val.strip("'\"")
                    result[key] = val
    except FileNotFoundError:
        log.warning("hook.env_file_missing", extra={"file": env_file})
    return result


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")

    if tool_name not in BRIDGED:
        log.debug("hook.passthrough", extra={"tool": tool_name})
        json.dump({}, sys.stdout)
        return

    log.debug("hook.invoked", extra={"tool": tool_name})

    tool_input = data.get("tool_input", {})

    # CC strips custom env vars from hook subprocesses — read from file
    relay_env = _load_relay_env()
    url = relay_env.get("ABOX_CALLBACK_URL", "") or os.environ.get("ABOX_CALLBACK_URL", "")
    token = relay_env.get("RELAY_AUTH_TOKEN", "") or os.environ.get("RELAY_AUTH_TOKEN", "")

    if not url or not token:
        log.warning("hook.config_missing", extra={"has_url": bool(url), "has_token": bool(token)})
        json.dump({}, sys.stdout)
        return

    endpoint = url.rstrip("/") + "/hook-bridge/"
    try:
        log.debug("hook.backend_call", extra={"tool": tool_name, "endpoint": endpoint})
        req = urllib.request.Request(
            endpoint,
            data=json.dumps({"tool_name": tool_name, "tool_input": tool_input}).encode(),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            log.info("hook.backend_response", extra={"tool": tool_name, "status": resp.status})
    except urllib.error.HTTPError as e:
        log.error("hook.backend_http_error", extra={
            "tool": tool_name, "status": e.code, "reason": e.reason,
        })
        error_msg = f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        log.error("hook.backend_network_error", extra={
            "tool": tool_name, "error": str(e.reason),
        })
        error_msg = f"network: {e.reason}"
    except Exception as e:
        log.error("hook.backend_error", extra={
            "tool": tool_name, "error": str(e), "error_type": type(e).__name__,
        })
        error_msg = str(e)
    else:
        error_msg = None

    if error_msg is not None:
        # PreToolUse: deny so CC doesnt write stale local files
        # PostToolUse: empty output is fine (native tool already ran)
        if tool_name in PRE:
            json.dump({
                "hookSpecificOutput": {"permissionDecision": "deny"},
                "systemMessage": f"[agentobox] Hook bridge error for {tool_name}: {error_msg}",
            }, sys.stdout)
        else:
            json.dump({}, sys.stdout)
        return

    payload = result.get("result", result)

    if tool_name in PRE:
        # Deny native tool, return backend data via systemMessage
        log.info("hook.pretooluse_denied", extra={"tool": tool_name})
        json.dump({
            "hookSpecificOutput": {"permissionDecision": "deny"},
            "systemMessage": _format_result(tool_name, payload),
        }, sys.stdout)
    else:
        # PostToolUse: native tool already ran, just confirm backend got it
        log.info("hook.posttooluse_forwarded", extra={"tool": tool_name})
        json.dump({
            "systemMessage": f"[agentobox] {tool_name} synced to backend.",
        }, sys.stdout)


if __name__ == "__main__":
    main()
