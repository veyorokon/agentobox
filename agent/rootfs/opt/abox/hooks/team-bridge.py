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
import os
import sys
import urllib.request

# Structure is the grouping — no per-tool "phase" attribute needed.
PRE = {"TaskList", "TaskGet"}
POST = {"SendMessage", "TaskCreate", "TaskUpdate"}
BRIDGED = PRE | POST


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")

    if tool_name not in BRIDGED:
        json.dump({}, sys.stdout)
        return

    tool_input = data.get("tool_input", {})
    url = os.environ.get("ABOX_CALLBACK_URL", "")
    token = os.environ.get("RELAY_AUTH_TOKEN", "")

    if not url or not token:
        # No backend config — let native tool run unimpeded
        json.dump({}, sys.stdout)
        return

    try:
        req = urllib.request.Request(
            url.rstrip("/") + "/hook-bridge/",
            data=json.dumps({"tool_name": tool_name, "tool_input": tool_input}).encode(),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
    except Exception as e:
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
            "systemMessage": f"[agentobox] {tool_name} result: {json.dumps(payload)}",
        }, sys.stdout)
    else:
        # PostToolUse: native tool already ran, just confirm backend got it
        json.dump({
            "systemMessage": f"[agentobox] {tool_name} synced to backend.",
        }, sys.stdout)


if __name__ == "__main__":
    main()
