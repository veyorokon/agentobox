import json
import textwrap

import structlog

from agents.adapters import get_adapter
from agents.adapters.claude_code import API_KEY_HELPER_PATH
from agents.runtimes.base import Runtime
from projects.models import Project

log = structlog.get_logger("agents.provision")

# tmpfs path for the API key (root:agent 0440)
API_KEY_TMPFS_PATH = "/run/secrets/anthropic_key"


async def provision_workspace(
    runtime: Runtime,
    sandbox_id: str,
    project: Project,
    agent_type: str = "claude-code",
    api_key: str = "",
    mcp_servers: dict | None = None,
    variant: str = "debian",
    workspace_path: str = "",
    instructions: str = "",
    secret_envs: dict[str, str] | None = None,
    agent_role: str = "worker",
    agent_name: str = "",
    team_members: list[dict] | None = None,
    team_name: str = "",
    relay_token: str = "",
    callback_url: str = "",
    mode: str = "auto",
    agent_tags: list[str] | None = None,
) -> None:
    """
    Write instruction file, settings, .mcp.json, and security
    hardening files into the agent container.

    Delegates agent-type-specific config (settings format, instruction content)
    to the adapter registered for `agent_type`.

    Args:
        agent_type: Adapter key (e.g. "claude-code"). Determines settings
            format and instruction file content.
        secret_envs: Flat {key: value} dict of decrypted secrets from
            ProjectSecret. Injected into every MCP server env block.
        agent_role: "lead" or "worker".
        agent_name: This agent's name (for team context).
        team_members: List of team member dicts for instruction file roster.
        team_name: Team name for lead's spawning instructions.
    """
    adapter = get_adapter(agent_type)
    op_log = log.bind(project_id=str(project.id), sandbox_id=sandbox_id)
    workspace = "/home/agent"
    op_log.info(
        "provisioning_workspace",
        context_path=workspace,
        variant=variant,
        workspace_path=workspace_path,
        agent_type=agent_type,
    )

    await runtime.exec(sandbox_id, ["mkdir", "-p", workspace])

    # Resolve MCP instruction strings from the registry
    mcp_instr = _resolve_mcp_instructions(mcp_servers)

    # Build instruction file (e.g. CLAUDE.md) via adapter
    instruction_content = adapter.build_instructions(
        project_name=project.name,
        agent_name=agent_name,
        agent_role=agent_role,
        workspace_path=workspace_path,
        instructions=instructions,
        team_members=team_members,
        team_name=team_name,
        mcp_instructions=mcp_instr,
        variant=variant,
    )
    await runtime.write_file(
        sandbox_id,
        instruction_content.encode("utf-8"),
        f"{workspace}/CLAUDE.md",
    )

    # Build settings file via adapter
    claude_dir = f"{workspace}/.claude"
    await runtime.exec(sandbox_id, ["mkdir", "-p", claude_dir])

    settings_content = adapter.build_settings(api_key=api_key, mode=mode)
    await runtime.write_file(
        sandbox_id,
        settings_content.encode("utf-8"),
        f"{claude_dir}/settings.json",
    )

    # MCP servers go in .mcp.json with env blocks for secrets.
    # Always write when relay_token is set (team coord server is always injected).
    coord_server = (
        _build_coord_server_config(callback_url, relay_token)
        if relay_token and callback_url else None
    )
    if mcp_servers or coord_server:
        mcp_config = _build_mcp_json(
            mcp_servers, secret_envs=secret_envs, coord_server=coord_server,
        )
        await runtime.write_file(
            sandbox_id,
            mcp_config.encode("utf-8"),
            f"{workspace}/.mcp.json",
        )

    # Write project skills that match this agent's tags as .claude/skills/<name>/SKILL.md
    await _provision_skills(runtime, sandbox_id, project, agent_tags or [], workspace, op_log)

    # Mark onboarding complete and pre-approve the API key so Claude Code
    # starts without interactive prompts
    claude_state = {
        "hasCompletedOnboarding": True,
        "bypassPermissionsModeAccepted": True,
    }
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
    # --- Security hardening ---
    await _provision_api_key_helper(runtime, sandbox_id, api_key, op_log)
    await _provision_scoped_sudo(runtime, sandbox_id, op_log)

    op_log.info("workspace_provisioned")


# ---------------------------------------------------------------------------
# API key helper (Layer 1: blocks env var leak)
# ---------------------------------------------------------------------------

async def _provision_api_key_helper(
    runtime: Runtime, sandbox_id: str, api_key: str, op_log,
) -> None:
    """
    Write the Anthropic API key to tmpfs and create a helper script that
    outputs it. Claude Code reads the key via apiKeyHelper in settings.json
    instead of from an env var.

    File layout:
        /run/secrets/anthropic_key  (root:agent 0440) — the key
        /opt/abox/api-key-helper.sh (root:root 0555) — cat helper
    """
    if not api_key:
        op_log.warning("api_key_helper_skipped", reason="no api key")
        return

    # Ensure /run/secrets exists (tmpfs in the agent image)
    await runtime.exec(
        sandbox_id,
        ["bash", "-c", "mkdir -p /run/secrets"],
        user="root",
    )

    # Write the key to tmpfs
    await runtime.write_file(sandbox_id, api_key.encode("utf-8"), API_KEY_TMPFS_PATH)
    await runtime.exec(
        sandbox_id,
        ["bash", "-c", f"chown root:agent {API_KEY_TMPFS_PATH} && chmod 0440 {API_KEY_TMPFS_PATH}"],
        user="root",
    )

    # Write the helper script
    helper_script = f"#!/bin/bash\ncat {API_KEY_TMPFS_PATH}\n"
    await runtime.exec(sandbox_id, ["mkdir", "-p", "/opt/abox"], user="root")
    await runtime.write_file(
        sandbox_id,
        helper_script.encode("utf-8"),
        API_KEY_HELPER_PATH,
    )
    await runtime.exec(
        sandbox_id,
        ["bash", "-c", f"chown root:root {API_KEY_HELPER_PATH} && chmod 0555 {API_KEY_HELPER_PATH}"],
        user="root",
    )

    op_log.info("api_key_helper_provisioned")


# ---------------------------------------------------------------------------
# Scoped sudo (Layer 2: blocks privilege escalation to read secrets)
# ---------------------------------------------------------------------------

async def _provision_scoped_sudo(
    runtime: Runtime, sandbox_id: str, op_log,
) -> None:
    """
    Replace blanket NOPASSWD sudo with package-manager-only access.

    Agents can: sudo apt-get install, sudo apt install, sudo dpkg -i
    Agents cannot: sudo cat, sudo bash, sudo chown/chmod
    """
    sudoers_content = (
        "# Agentobox: scoped sudo for agent container\n"
        "# Allows package management only — blocks reading secrets via sudo\n"
        "agent ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/dpkg\n"
    )
    sudoers_path = "/etc/sudoers.d/agentobox"

    await runtime.write_file(
        sandbox_id,
        sudoers_content.encode("utf-8"),
        sudoers_path,
    )
    await runtime.exec(
        sandbox_id,
        ["bash", "-c", f"chmod 0440 {sudoers_path}"],
        user="root",
    )

    # Remove the blanket rule if it exists in the main sudoers file
    # (defensive — the main sudoers may have "agent ALL=(ALL) NOPASSWD:ALL")
    await runtime.exec(
        sandbox_id,
        ["bash", "-c", "sed -i '/agent.*NOPASSWD.*ALL$/d' /etc/sudoers"],
        user="root",
    )

    op_log.info("scoped_sudo_provisioned")


# ---------------------------------------------------------------------------
# Skill provisioning
# ---------------------------------------------------------------------------


async def _provision_skills(
    runtime: Runtime,
    sandbox_id: str,
    project: Project,
    agent_tags: list[str],
    workspace: str,
    op_log,
) -> None:
    """Write project skills matching the agent's tags as .claude/skills/<name>/SKILL.md."""
    from asgiref.sync import sync_to_async
    from agents.models import Skill

    # Use sync_to_async because this runs in a detached asyncio.create_task
    # where the original HTTP request's CurrentThreadExecutor is already dead.
    skills = await sync_to_async(
        lambda: list(Skill.objects.filter(project=project)),
        thread_sensitive=False,
    )()
    matching = [
        s for s in skills
        if s.assigned_to_all or any(tag in agent_tags for tag in (s.assigned_tags or []))
    ]

    if not matching:
        return

    skills_base = f"{workspace}/.claude/skills"
    await runtime.exec(sandbox_id, ["mkdir", "-p", skills_base])

    for skill in matching:
        # Sanitize skill name to prevent path traversal
        safe_name = skill.name.replace("/", "_").replace("..", "_").strip(".")
        if not safe_name:
            continue
        skill_dir = f"{skills_base}/{safe_name}"
        await runtime.exec(sandbox_id, ["mkdir", "-p", skill_dir])
        await runtime.write_file(
            sandbox_id,
            skill.content.encode("utf-8"),
            f"{skill_dir}/SKILL.md",
        )

    op_log.info("skills_provisioned", count=len(matching))


# ---------------------------------------------------------------------------
# MCP config builder
# ---------------------------------------------------------------------------

def _build_mcp_json(
    mcp_servers: dict | None = None,
    secret_envs: dict[str, str] | None = None,
    coord_server: dict | None = None,
) -> str:
    """
    Build .mcp.json content with secrets injected into every server's env block.

    All project secrets are merged flat and injected into every MCP server's
    env block. MCP servers ignore keys they don't recognize, so extra keys
    are harmless. This avoids needing per-server secret routing.

    Args:
        mcp_servers: {name: {command, args, ...}} — resolved MCP config
        secret_envs: flat {KEY: VALUE} — decrypted project secrets
        coord_server: HTTP MCP config for the team coordination server
    """
    servers = {}
    if mcp_servers:
        for name, config in mcp_servers.items():
            entry = {"command": config["command"], "args": config["args"]}
            if secret_envs:
                entry["env"] = dict(secret_envs)
            servers[name] = entry

    if coord_server:
        servers["team"] = coord_server

    return json.dumps({"mcpServers": servers}, indent=2)


def _build_coord_server_config(callback_url: str, relay_token: str) -> dict:
    """Build the team coordination HTTP MCP server config for .mcp.json."""
    return {
        "type": "http",
        "url": f"{callback_url}/mcp",
        "headers": {
            "Authorization": f"Bearer {relay_token}",
        },
    }


def _resolve_mcp_instructions(mcp_servers: dict | None) -> list[str]:
    """Extract MCP instruction strings from MCP_REGISTRY for resolved servers."""
    if not mcp_servers:
        return []
    result = []
    for name in mcp_servers:
        entry = MCP_REGISTRY.get(name, {})
        instr = entry.get("instructions")
        if instr:
            result.append(textwrap.dedent(instr))
    return result


# ---------------------------------------------------------------------------
# Platform registries (agent-type agnostic)
# ---------------------------------------------------------------------------

# Team configuration templates
# Each template defines a complete agent team with role, model, and responsibilities
TEAM_CONFIGS = {
    "solo": {
        "agents": [
            {
                "name": "team-lead",
                "role": "lead",
                "model": "claude-opus-4-6",
                "instructions": "You are the team lead and sole agent. Handle all aspects of the project.",
                "mcp_servers": ["computer-use"],
            }
        ]
    },
    "fullstack": {
        "agents": [
            {
                "name": "team-lead",
                "role": "lead",
                "model": "claude-opus-4-6",
                "instructions": "Coordinate the team, delegate tasks, review work, and maintain overall project vision.",
                "mcp_servers": ["computer-use"],
            },
            {
                "name": "backend",
                "role": "worker",
                "model": "claude-sonnet-4-5-20250929",
                "instructions": "Backend development: APIs, database models, business logic, services.",
                "mcp_servers": [],
            },
            {
                "name": "frontend",
                "role": "worker",
                "model": "claude-sonnet-4-5-20250929",
                "instructions": "Frontend development: UI components, styling, client-side logic, user experience.",
                "mcp_servers": [],
            },
            {
                "name": "qa",
                "role": "worker",
                "model": "claude-sonnet-4-5-20250929",
                "instructions": "Quality assurance: testing, verification, bug reports, test automation.",
                "mcp_servers": ["playwright"],
            },
        ]
    },
}

# Available models for agent provisioning.
# value = Anthropic model ID passed to Claude Code via --model
# label = human-friendly name shown in the dashboard
MODELS_REGISTRY = [
    {"value": "claude-sonnet-4-5-20250929", "label": "Sonnet 4.5"},
    {"value": "claude-opus-4-20250514", "label": "Opus 4"},
    {"value": "claude-opus-4-6", "label": "Opus 4.6"},
]

# Known MCP servers bundled into the agent image.
# Keys match checkbox values in the deploy modal.
# Each entry has:
#   command/args: how to start the server
#   compat: list of image variants where this server works
#   instructions: behavioral guidance injected into instruction file when attached
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


async def write_secrets_env(runtime: Runtime, sandbox_id: str, secret_envs: dict[str, str] | None) -> None:
    """Write project secrets to /mnt/abox-state/secrets/env for shell access.

    Format: export KEY="VALUE" lines, sourced by .bashrc so every Bash tool
    call gets fresh secrets without a restart.

    Used during initial provisioning (lifecycle.py) and hot-reload (push_secrets_to_agent).
    """

    if not secret_envs:
        content = "# Auto-generated by agentobox. No secrets configured.\n"
    else:
        lines = ["# Auto-generated by agentobox. Do not edit."]
        for key, value in secret_envs.items():
            # Escape double quotes and backslashes in values
            escaped = value.replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f'export {key}="{escaped}"')
        content = "\n".join(lines) + "\n"

    await runtime.write_file(sandbox_id, content.encode("utf-8"), "/mnt/abox-state/secrets/env")


async def write_theme_files(runtime: Runtime, sandbox_id: str, tokens: dict[str, str]) -> None:
    """Write theme tokens to /tmp/abox-theme.lua and /tmp/abox-theme.json.

    Two consumers read from /tmp:
    - AwesomeWM rc.lua polls abox-theme.lua (Lua table format)
    - Firefox native messaging host reads abox-theme.json

    Token keys use the same names as CSS variables (minus --), e.g.
    "muted-foreground". Lua accesses them via bracket notation.
    """
    # Lua format for AwesomeWM
    entries = ", ".join(
        f'["{k}"] = "{v}"' for k, v in sorted(tokens.items())
    )
    lua_content = f"return {{ {entries} }}\n"
    await runtime.write_file(sandbox_id, lua_content.encode("utf-8"), "/tmp/abox-theme.lua")

    # JSON format for Firefox theme bridge
    json_content = json.dumps(tokens, indent=2) + "\n"
    await runtime.write_file(sandbox_id, json_content.encode("utf-8"), "/tmp/abox-theme.json")

    log.info("theme_files_written", sandbox_id=sandbox_id[:12], token_count=len(tokens))


async def push_secrets_to_agent(runtime: Runtime, sandbox_id: str, agent, secret_envs: dict[str, str]) -> None:
    """
    Hot-reload secrets on a running agent by rewriting files.

    1. Rewrites .mcp.json with updated env blocks (MCP servers re-init on restart)
    2. Writes /mnt/abox-state/secrets/env for immediate shell access
    """
    from django.conf import settings as django_settings

    workspace = "/home/agent"

    # Rebuild coord server config if agent has a relay_token
    coord_server = None
    if agent.relay_token:
        callback_url = getattr(django_settings, "ABOX_CALLBACK_URL", "")
        if callback_url:
            coord_server = _build_coord_server_config(callback_url, agent.relay_token)

    if agent.mcp_servers or coord_server:
        mcp_config = _build_mcp_json(
            agent.mcp_servers, secret_envs=secret_envs,
            coord_server=coord_server,
        )
        await runtime.write_file(
            sandbox_id,
            mcp_config.encode("utf-8"),
            f"{workspace}/.mcp.json",
        )

    # Write secrets env file for shell access (zero-restart path)
    await write_secrets_env(runtime, sandbox_id, secret_envs)

    log.info(
        "secrets_pushed",
        agent_name=agent.name,
        sandbox_id=sandbox_id[:12],
        secret_count=len(secret_envs),
    )
