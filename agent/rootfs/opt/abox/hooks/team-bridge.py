#!/usr/bin/env python3
"""Hook bridge: intercept CC native team tools, route through agentobox backend.

PreToolUse: read-only tools (TaskList, TaskGet) — deny native execution,
    return backend result via systemMessage.
PostToolUse: mutating tools (SendMessage, TaskCreate, TaskUpdate) — native
    tool already ran, forward to backend for DB persistence.

Stdlib only — no pip dependencies. Runs inside agent container as child of
CC process. Inherits env vars from relay: ABOX_CALLBACK_URL, RELAY_AUTH_TOKEN.
"""

import json
import logging
import os
import sys
import urllib.request

# Log to stderr (captured by relay log infrastructure)
logging.basicConfig(
    stream=sys.stderr,
    level=logging.DEBUG,
    format='%(asctime)s %(levelname)s %(message)s',
)
log = logging.getLogger("team-bridge")

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


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")

    if tool_name not in BRIDGED:
        log.debug("not bridged, passthrough: %s", tool_name)
        json.dump({}, sys.stdout)
        return

    log.debug("hook invoked: %s", tool_name)

    tool_input = data.get("tool_input", {})
    url = os.environ.get("ABOX_CALLBACK_URL", "")
    token = os.environ.get("RELAY_AUTH_TOKEN", "")

    if not url or not token:
        # No backend config — let native tool run unimpeded
        log.warning("no ABOX_CALLBACK_URL or RELAY_AUTH_TOKEN, passthrough")
        json.dump({}, sys.stdout)
        return

    endpoint = url.rstrip("/") + "/hook-bridge/"
    try:
        log.debug("calling backend: %s %s", tool_name, endpoint)
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
            log.info("backend response: %s status=%d", tool_name, resp.status)
    except Exception as e:
        log.error("backend error for %s: %s", tool_name, e)
        # PreToolUse: deny so CC doesnt write stale local files
        # PostToolUse: empty output is fine (native tool already ran)
        if tool_name in PRE:
            json.dump({
                "hookSpecificOutput": {"permissionDecision": "deny"},
                "systemMessage": f"[agentobox] Hook bridge error for {tool_name}: {e}",
            }, sys.stdout)
        else:
            json.dump({}, sys.stdout)
        return

    payload = result.get("result", result)

    if tool_name in PRE:
        # Deny native tool, return backend data via systemMessage
        json.dump({
            "hookSpecificOutput": {"permissionDecision": "deny"},
            "systemMessage": _format_result(tool_name, payload),
        }, sys.stdout)
    else:
        # PostToolUse: native tool already ran, just confirm backend got it
        json.dump({
            "systemMessage": f"[agentobox] {tool_name} synced to backend.",
        }, sys.stdout)


if __name__ == "__main__":
    main()
