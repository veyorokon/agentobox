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
    mcp_servers: dict | None = None,
    variant: str = "debian",
    workspace_path: str = "",
    instructions: str = "",
) -> None:
    """Write CLAUDE.md and .claude/settings.json into the agent container."""
    op_log = log.bind(project_id=str(project.id), sandbox_id=sandbox_id)
    workspace = "/home/computeruse"
    op_log.info("provisioning_workspace", context_path=workspace, variant=variant, workspace_path=workspace_path)

    await runtime.exec(sandbox_id, ["mkdir", "-p", workspace])

    claude_md = _build_claude_md(project, mcp_servers=mcp_servers, variant=variant, workspace_path=workspace_path, instructions=instructions)
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

    # MCP servers go in .mcp.json (not settings.json)
    if mcp_servers:
        mcp_json = json.dumps({"mcpServers": mcp_servers}, indent=2)
        await runtime.write_file(
            sandbox_id,
            mcp_json.encode("utf-8"),
            f"{workspace}/.mcp.json",
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


def _build_claude_md(
    project: Project,
    mcp_servers: dict | None = None,
    variant: str = "debian",
    workspace_path: str = "",
    instructions: str = "",
) -> str:
    os_desc = IMAGE_VARIANTS.get(variant, IMAGE_VARIANTS["debian"])

    if workspace_path:
        workspace_section = (
            "## Workspace\n"
            "\n"
            "You are working in `/home/computeruse/workspace` (mounted from host).\n"
            "This is a shared volume — changes you make are visible on the host and\n"
            "to other agents. Stay within this directory for project work.\n"
        )
    else:
        workspace_section = (
            "## Workspace\n"
            "\n"
            "You are working in `/home/computeruse`. Stay within this directory.\n"
        )

    base = (
        f"# {project.name}\n"
        f"\n"
        f"You are an agentobox agent working on the {project.name} project.\n"
        f"\n"
        f"{workspace_section}"
        f"\n"
        f"## Environment\n"
        f"\n"
        f"- OS: {os_desc}\n"
        f"- Display: X11 on `:1` (AwesomeWM window manager)\n"
        f"- Browser: Firefox ESR (pre-installed)\n"
        f"\n"
        f"## Services\n"
        f"\n"
        f"- Backend API: available at env var `ABOX_CALLBACK_URL`\n"
        f"- Dashboard: available at env var `ABOX_DASHBOARD_URL`\n"
    )

    if instructions:
        base += f"\n## Responsibilities\n\n{instructions.strip()}\n"

    # Append instructions from attached MCP servers
    if mcp_servers:
        for name in mcp_servers:
            entry = MCP_REGISTRY.get(name, {})
            mcp_instructions = entry.get("instructions")
            if mcp_instructions:
                base += "\n" + textwrap.dedent(mcp_instructions).strip() + "\n"

    return base


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

# Image variants and their OS descriptions for CLAUDE.md
IMAGE_VARIANTS = {
    "alpine": "Alpine Linux (use `apk` not `apt`)",
    "debian": "Debian Linux (use `apt` not `apk`)",
}

# Known MCP servers bundled into the agent image.
# Keys match checkbox values in the deploy modal.
# Each entry has:
#   command/args: how to start the server
#   compat: list of image variants where this server works
#   instructions: behavioral guidance injected into CLAUDE.md when attached
MCP_REGISTRY = {
    "playwright": {
        "command": "npx",
        "args": ["@playwright/mcp@latest"],
        "compat": ["debian"],
        "instructions": """
            ## Playwright

            You have Playwright MCP for browser automation and testing.
            Use it to navigate pages, click elements, fill forms, take
            screenshots, and assert page state.

            ### Usage

            - Use `browser_navigate` to open URLs
            - Use `browser_snapshot` to get the accessibility tree (preferred over screenshots)
            - Use `browser_click`, `browser_type`, `browser_fill_form` for interactions
            - Use `browser_take_screenshot` for visual verification

            ### Rules

            - Always take a snapshot or screenshot after navigation to see the page state
            - Use accessibility snapshots over screenshots when possible — they're faster and actionable
            - Close the browser when done with `browser_close`
        """,
    },
    "computer-use": {
        "command": "node",
        "args": ["/opt/mcp-servers/computer-use/dist/main.js"],
        "compat": ["debian"],
        "instructions": """
            ## Computer Use

            You have a desktop environment with a display, mouse, and keyboard
            accessible through the `computer` MCP tool. **Use the computer
            tool for GUI interactions** — clicking, typing, scrolling, and
            taking screenshots.

            ### Desktop

            There is a dock bar at the bottom of the screen with app launchers
            (Firefox, Terminal). To open an app, click its icon in the dock.
            If the app you need is not in the dock, you may launch it from
            bash — this is the only acceptable reason to use bash for GUI apps.

            ### How to interact

            1. **Screenshot first** — before every action, take a screenshot
               to see the current screen state.
            2. **Click, type, scroll** — interact with what you see, like a
               human sitting at the computer. Click buttons, type into fields,
               scroll to find content.
            3. **Screenshot after** — verify your action had the expected
               effect before proceeding.

            ### Browser

            - Firefox is in the dock. Click its icon to open it.
            - To navigate: click the address bar, type the URL, press Enter.
            - To follow a link: click it. To go back: click the back button.
            - To search: click the search/address bar, type your query, press
              Enter.

            ### Rules

            - **Use the dock to launch apps.** Click the app icon in the
              bottom dock bar. Only use bash to launch apps not in the dock.
            - **Never use bash to type into GUI apps.** Use the computer tool's
              `type` and `key` actions instead.
            - **Always verify with screenshots.** After clicking or typing,
              take a screenshot to confirm the result before your next action.
            - **Be patient.** Pages and apps take time to load. If a click
              doesn't seem to work, take another screenshot after a moment —
              don't immediately retry.
        """,
    },
}


def resolve_mcp_servers(names: list[str], variant: str = "debian") -> dict:
    """Resolve a list of MCP names to their full config from the registry.

    Skips servers incompatible with the given image variant.
    """
    resolved = {}
    for name in names:
        entry = MCP_REGISTRY.get(name)
        if not entry:
            continue
        compat = entry.get("compat")
        if compat and variant not in compat:
            log.warning(
                "mcp_server_incompatible",
                server=name,
                variant=variant,
                compat=compat,
            )
            continue
        resolved[name] = {
            "command": entry["command"],
            "args": entry["args"],
        }
    return resolved


def _build_settings_json() -> str:
    hook_entry = [{"matcher": "*", "hooks": [{"type": "command", "command": _HOOK_CMD}]}]
    settings = {
        "theme": "dark",
        "defaultMode": "bypassPermissions",
        "enableAllProjectMcpServers": True,
        "hooks": {e: hook_entry for e in _HOOK_EVENTS},
    }
    return json.dumps(settings, indent=2)
