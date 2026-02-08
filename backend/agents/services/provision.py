import json
import textwrap

import structlog

from agents.runtimes.base import Runtime
from projects.models import Project

log = structlog.get_logger("agents.provision")


async def provision_workspace(
    runtime: Runtime,
    sandbox_id: str,
    project: Project,
    api_key: str = "",
    agent_env: dict[str, str] | None = None,
) -> None:
    """Write CLAUDE.md and .claude/settings.json into the agent container."""
    op_log = log.bind(project_id=str(project.id), sandbox_id=sandbox_id)
    workspace = "/home/computeruse"
    op_log.info("provisioning_workspace", context_path=workspace)

    await runtime.exec(sandbox_id, ["mkdir", "-p", workspace])

    claude_md = _build_claude_md(project)
    await runtime.write_file(
        sandbox_id,
        claude_md.encode("utf-8"),
        f"{workspace}/CLAUDE.md",
    )

    claude_dir = f"{workspace}/.claude"
    await runtime.exec(sandbox_id, ["mkdir", "-p", claude_dir])

    settings_json = _build_settings_json()
    await runtime.write_file(
        sandbox_id,
        settings_json.encode("utf-8"),
        f"{claude_dir}/settings.json",
    )

    # Mark onboarding complete and pre-approve the API key so Claude Code
    # starts without interactive prompts
    claude_state = {"hasCompletedOnboarding": True, "bypassPermissionsModeAccepted": True}
    if api_key and len(api_key) >= 20:
        claude_state["customApiKeyResponses"] = {
            "approved": [api_key[-20:]],
            "rejected": [],
        }
    claude_json = json.dumps(claude_state)
    await runtime.write_file(
        sandbox_id,
        claude_json.encode("utf-8"),
        f"{workspace}/.claude.json",
    )

    # Write hook-event.sh (may not exist in older images)
    hooks_dir = f"{workspace}/hooks"
    await runtime.exec(sandbox_id, ["mkdir", "-p", hooks_dir])
    await runtime.write_file(
        sandbox_id,
        _HOOK_EVENT_SH.encode("utf-8"),
        f"{hooks_dir}/hook-event.sh",
    )
    await runtime.exec(sandbox_id, ["chmod", "+x", f"{hooks_dir}/hook-event.sh"])

    # Write agent env vars so hooks (running as computeruse) can access them
    if agent_env:
        env_lines = [f'export {k}="{v}"' for k, v in agent_env.items()]
        env_content = "\n".join(env_lines) + "\n"
        env_path = f"{workspace}/.agent_env"
        await runtime.write_file(sandbox_id, env_content.encode("utf-8"), env_path)

    op_log.info("workspace_provisioned")


def _build_claude_md(project: Project) -> str:
    return textwrap.dedent(f"""\
        # {project.name}

        You are an agentobox agent working on the {project.name} project.

        ## Workspace

        You are working in `/home/computeruse`. Stay within this directory.
    """)


_HOOK_EVENT_SH = r"""#!/bin/bash
# Forward Claude Code hook events to agentobox control plane
[ -f "$HOME/.agent_env" ] && . "$HOME/.agent_env"
CALLBACK_URL="${ABOX_CALLBACK_URL:-}"
AGENT_ID="${AGENT_ID:-}"
[ -z "$CALLBACK_URL" ] || [ -z "$AGENT_ID" ] && exit 0

INPUT=$(cat)
BODY=$(echo "$INPUT" | jq -c --arg id "$AGENT_ID" '. + {agent_id: $id}')

RESPONSE=$(curl -sf -X POST "${CALLBACK_URL}/hooks/event" \
    -H "Content-Type: application/json" \
    -d "$BODY" 2>/dev/null) || exit 0

# SessionStart: persist env for subsequent hooks
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // empty')
if [ "$EVENT_NAME" = "SessionStart" ] && [ -n "$CLAUDE_ENV_FILE" ]; then
    echo "export AGENT_ID=\"$AGENT_ID\"" >> "$CLAUDE_ENV_FILE"
    echo "export ABOX_CALLBACK_URL=\"$CALLBACK_URL\"" >> "$CLAUDE_ENV_FILE"
fi

# Control plane feedback
MESSAGE=$(echo "$RESPONSE" | jq -r '.message // empty')
[ -n "$MESSAGE" ] && echo "{\"systemMessage\": \"$MESSAGE\"}"
exit 0
"""

_HOOK_EVENTS = [
    "SessionStart", "SessionEnd", "PostToolUse", "Stop",
    "TaskCompleted", "SubagentStart", "SubagentStop",
    "TeammateIdle", "Notification",
]
_HOOK_CMD = "bash /home/computeruse/hooks/hook-event.sh"


def _build_settings_json() -> str:
    hook_entry = [{"matcher": "*", "hooks": [{"type": "command", "command": _HOOK_CMD}]}]
    settings = {
        "theme": "dark",
        "defaultMode": "bypassPermissions",
        "hooks": {e: hook_entry for e in _HOOK_EVENTS},
    }
    return json.dumps(settings, indent=2)
