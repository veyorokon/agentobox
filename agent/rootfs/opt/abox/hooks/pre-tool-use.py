#!/usr/bin/env python3
"""
PreToolUse hook: intercept Task(team_name) for distributed container creation.

When a team lead calls Task(team_name=..., name=...), Claude Code would
normally spawn a local tmux pane. In Agentobox, agents run in separate
containers. This hook blocks local execution and creates a real container
via the backend instead.

Only intercepts Task calls with team_name set. Plain Task calls (subagents)
pass through and execute locally inside the container.

Exit codes:
    0 = allow (tool executes normally)
    2 = feedback (stderr injected as system message, tool blocked)

See: docs/ARCHITECTURE.md
"""

import json
import sys
import os
from urllib.request import Request, urlopen

input_data = json.loads(sys.stdin.read())
tool_name = input_data.get("tool_name", "")
tool_input = input_data.get("tool_input", {})

# Only intercept Task calls with team_name (teammate spawning)
if tool_name != "Task" or not tool_input.get("team_name"):
    # Allow all other tools and non-team Task calls (subagents)
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
            }
        },
        sys.stdout,
    )
    sys.exit(0)

# --- This is a teammate spawn request. Block local execution. ---
teammate_name = tool_input.get("name", "teammate")
prompt = tool_input.get("prompt", "")
model = tool_input.get("model")
subagent_type = tool_input.get("subagent_type", "general-purpose")

callback_url = os.environ.get("ABOX_CALLBACK_URL", "").rstrip("/")
agent_id = os.environ.get("AGENT_ID", "")
relay_token = os.environ.get("RELAY_AUTH_TOKEN", "")

payload = {
    "name": teammate_name,
    "prompt": prompt,
    "model": model,
    "subagent_type": subagent_type,
}

try:
    req = Request(
        f"{callback_url}/agents/{agent_id}/hook/create-teammate",
        data=json.dumps(payload).encode(),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Relay-Token", relay_token)
    with urlopen(req, timeout=5) as resp:
        result = json.loads(resp.read())
except Exception as e:
    print(f"Failed to create teammate '{teammate_name}': {e}", file=sys.stderr)
    sys.exit(2)

# Block local execution, inject feedback
print(
    f"Deploying teammate '{teammate_name}' as a container. "
    f"It will message you when ready. Continue with other work.",
    file=sys.stderr,
)
sys.exit(2)
