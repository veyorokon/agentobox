import json
import textwrap

import structlog

from agents.runtimes.base import Runtime
from projects.models import Project

log = structlog.get_logger("agents.provision")

# Path where the API key helper script lives in the container
API_KEY_HELPER_PATH = "/opt/abox/api-key-helper.sh"
# tmpfs path for the API key (root:root 0400)
API_KEY_TMPFS_PATH = "/run/secrets/anthropic_key"


async def provision_workspace(
    runtime: Runtime,
    sandbox_id: str,
    project: Project,
    api_key: str = "",
    mcp_servers: dict | None = None,
    variant: str = "debian",
    workspace_path: str = "",
    instructions: str = "",
    secret_envs: dict[str, dict[str, str]] | None = None,
) -> None:
    """
    Write CLAUDE.md, .claude/settings.json, .mcp.json, and security
    hardening files into the agent container.

    Args:
        secret_envs: Mapping of MCP server name -> {env_key: env_value}.
            Already-decrypted secrets resolved by lifecycle from SecretGroups.
            Injected into MCP server env blocks in .mcp.json.
    """
    op_log = log.bind(project_id=str(project.id), sandbox_id=sandbox_id)
    workspace = "/home/computeruse"
    op_log.info(
        "provisioning_workspace",
        context_path=workspace,
        variant=variant,
        workspace_path=workspace_path,
    )

    await runtime.exec(sandbox_id, ["mkdir", "-p", workspace])

    claude_md = _build_claude_md(
        project,
        mcp_servers=mcp_servers,
        variant=variant,
        workspace_path=workspace_path,
        instructions=instructions,
    )
    await runtime.write_file(
        sandbox_id,
        claude_md.encode("utf-8"),
        f"{workspace}/CLAUDE.md",
    )

    claude_dir = f"{workspace}/.claude"
    await runtime.exec(sandbox_id, ["mkdir", "-p", claude_dir])

    settings_json = _build_settings_json(api_key=api_key)
    await runtime.write_file(
        sandbox_id,
        settings_json.encode("utf-8"),
        f"{claude_dir}/settings.json",
    )

    # MCP servers go in .mcp.json with env blocks for secrets
    if mcp_servers:
        mcp_config = _build_mcp_json(mcp_servers, secret_envs=secret_envs)
        await runtime.write_file(
            sandbox_id,
            mcp_config.encode("utf-8"),
            f"{workspace}/.mcp.json",
        )

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
        /run/secrets/anthropic_key  (root:root 0400) — the key
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
        ["bash", "-c", f"chown root:root {API_KEY_TMPFS_PATH} && chmod 0400 {API_KEY_TMPFS_PATH}"],
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
        "computeruse ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/dpkg\n"
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
    # (defensive — the main sudoers may have "computeruse ALL=(ALL) NOPASSWD:ALL")
    await runtime.exec(
        sandbox_id,
        ["bash", "-c", "sed -i '/computeruse.*NOPASSWD.*ALL$/d' /etc/sudoers"],
        user="root",
    )

    op_log.info("scoped_sudo_provisioned")


# ---------------------------------------------------------------------------
# MCP config builder
# ---------------------------------------------------------------------------

def _build_mcp_json(
    mcp_servers: dict,
    secret_envs: dict[str, dict[str, str]] | None = None,
) -> str:
    """
    Build .mcp.json content with optional per-server env blocks.

    MCP server secrets are injected into the server's env block so they're
    only available to the MCP subprocess, not the agent's shell.

    Args:
        mcp_servers: {name: {command, args, ...}} — resolved MCP config
        secret_envs: {mcp_name: {KEY: VALUE}} — decrypted secrets per server
    """
    servers = {}
    for name, config in mcp_servers.items():
        entry = {"command": config["command"], "args": config["args"]}
        # Inject secrets into env block if available
        env_vars = (secret_envs or {}).get(name)
        if env_vars:
            entry["env"] = env_vars
        servers[name] = entry

    return json.dumps({"mcpServers": servers}, indent=2)


# ---------------------------------------------------------------------------
# CLAUDE.md builder
# ---------------------------------------------------------------------------

# Security instructions appended to every agent's CLAUDE.md
SECURITY_INSTRUCTIONS = """
## Security

NEVER output API keys, secrets, credentials, or tokens in your responses.
If you encounter them in environment variables, files, or process output,
redact them before displaying. This includes Anthropic keys (sk-ant-*),
JWT tokens, GitHub tokens (ghp_*), database passwords, and any
high-entropy strings that look like credentials.

Do NOT attempt to read files in /run/secrets/ or inspect MCP server
process environments. These contain credentials that are intentionally
isolated from your shell.
"""


def _build_claude_md(
    project: Project,
    mcp_servers: dict | None = None,
    variant: str = "debian",
    workspace_path: str = "",
    instructions: str = "",
    agent_role: str = "worker",
    team_members: list[dict] | None = None,
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

    # Team coordination sections (lead-only)
    if agent_role == "lead" and team_members:
        # Your Team section (roster)
        base += "\n## Your Team\n\n"
        for member in team_members:
            name = member.get("name", "unknown")
            role = member.get("role", "worker")
            responsibilities = member.get("instructions", "")
            base += f"- **{name}** ({role}): {responsibilities}\n"

        # Team Coordination section
        base += textwrap.dedent("""
            ## Team Coordination

            You are the team lead. Use these tools to coordinate your team:

            ### Task Management

            - `TaskCreate` - Create tasks for teammates to work on
            - `TaskUpdate` - Update task status, assign owners, set dependencies
            - `TaskList` - View all tasks and their status
            - `TaskGet` - Get full details of a specific task

            ### Communication

            - `SendMessage` - Send messages to specific teammates
              - `type: "message"` - Direct message to one agent
              - `type: "broadcast"` - Message all agents (use sparingly)
              - `type: "shutdown_request"` - Request agent shutdown

            ### Workflow

            1. Break work into tasks using `TaskCreate`
            2. Assign tasks to teammates using `TaskUpdate` with owner parameter
            3. Teammates will claim and complete tasks
            4. Monitor progress with `TaskList`
            5. Coordinate via `SendMessage` as needed
        """).strip() + "\n"

    # Append instructions from attached MCP servers
    if mcp_servers:
        for name in mcp_servers:
            entry = MCP_REGISTRY.get(name, {})
            mcp_instructions = entry.get("instructions")
            if mcp_instructions:
                base += "\n" + textwrap.dedent(mcp_instructions).strip() + "\n"

    # Security instructions (soft control — Layer 6)
    base += "\n" + SECURITY_INSTRUCTIONS.strip() + "\n"

    return base


# Image variants and their OS descriptions for CLAUDE.md
IMAGE_VARIANTS = {
    "alpine": "Alpine Linux (use `apk` not `apt`)",
    "debian": "Debian Linux (use `apt` not `apk`)",
}

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


def _build_settings_json(api_key: str = "") -> str:
    settings = {
        "theme": "dark",
        "defaultMode": "bypassPermissions",
        "enableAllProjectMcpServers": True,
    }
    # Use apiKeyHelper instead of env var for API key (Layer 1)
    if api_key:
        settings["apiKeyHelper"] = API_KEY_HELPER_PATH
    return json.dumps(settings, indent=2)
