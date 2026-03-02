"""
Workspace provisioning — write config files into agent containers.

Called during _provision_agent (lifecycle.py) after the container is created.
Writes into the container filesystem via runtime.write_file/exec:

    1. CLAUDE.md — instructions built by the adapter (team roster, MCP docs,
       role-specific context, user-provided instructions)
    2. .claude/settings.json — agent settings (API key, permission mode)
    3. .mcp.json — MCP server configs with env blocks for project secrets,
       plus the team coordination HTTP server if relay_token is set
    4. .claude.json — onboarding state (marks setup complete)
    5. API key files — adapter-provided file specs (path, content, mode, owner)
    6. Scoped sudoers — restricts sudo to package management only
    7. Skills — project skills matching agent tags as .claude/skills/<name>/SKILL.md

All agent-type-specific config (file formats, instruction content) is
delegated to the adapter via get_adapter(agent_type). This module handles
only the I/O orchestration.

Also provides utilities for hot-reloading secrets (write_secrets_env,
push_secrets_to_agent) and theme files (write_theme_files) on running agents.
"""
import json

import structlog

from agents.adapters import get_adapter
from agents.runtimes.base import Runtime
from projects.models import Project

log = structlog.get_logger("abox.lifecycle")


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
        "lifecycle.provisioning_workspace",
        context_path=workspace,
        variant=variant,
        workspace_path=workspace_path,
        agent_type=agent_type,
    )

    await runtime.exec(sandbox_id, ["mkdir", "-p", workspace])

    # Resolve MCP instruction strings via adapter
    mcp_instr = adapter.resolve_mcp_instructions(mcp_servers)

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
        mcp_config = adapter.build_mcp_config(
            mcp_servers=mcp_servers, secret_envs=secret_envs,
            coord_server=coord_server,
        )
        await runtime.write_file(
            sandbox_id,
            mcp_config.encode("utf-8"),
            f"{workspace}/.mcp.json",
        )

    # Write project skills that match this agent's tags as .claude/skills/<name>/SKILL.md
    await _provision_skills(runtime, sandbox_id, project, agent_tags or [], workspace, op_log)

    # Mark onboarding complete via adapter
    onboarding_content = adapter.build_onboarding_state(api_key=api_key)
    if onboarding_content:
        await runtime.write_file(
            sandbox_id,
            onboarding_content.encode("utf-8"),
            f"{workspace}/.claude.json",
        )

    # --- Security hardening ---
    await _provision_api_key_files(runtime, sandbox_id, adapter.build_api_key_files(api_key), op_log)
    await _provision_scoped_sudo(runtime, sandbox_id, op_log)

    op_log.info("lifecycle.workspace_provisioned")


# ---------------------------------------------------------------------------
# API key file provisioning (generic writer for adapter-provided file specs)
# ---------------------------------------------------------------------------

async def _provision_api_key_files(
    runtime: Runtime, sandbox_id: str, file_specs: list[dict], op_log,
) -> None:
    """Write API key files from adapter-provided specs.

    Each spec is {path, content, mode, owner}. The adapter decides WHAT
    files to write; this function handles the I/O.
    """
    if not file_specs:
        op_log.warning("lifecycle.api_key_skipped", reason="no api key")
        return

    for spec in file_specs:
        parent = spec["path"].rsplit("/", 1)[0]
        await runtime.exec(sandbox_id, ["mkdir", "-p", parent], user="root")
        await runtime.write_file(
            sandbox_id,
            spec["content"].encode("utf-8"),
            spec["path"],
        )
        owner = spec.get("owner", "root:root")
        mode = spec.get("mode", "0644")
        await runtime.exec(
            sandbox_id,
            ["chown", owner, spec["path"]],
            user="root",
        )
        await runtime.exec(
            sandbox_id,
            ["chmod", mode, spec["path"]],
            user="root",
        )

    op_log.info("lifecycle.api_key_provisioned")


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

    op_log.info("lifecycle.sudo_provisioned")


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

    op_log.info("lifecycle.skills_provisioned", count=len(matching))


# ---------------------------------------------------------------------------
# Coord server config (generic — any agent type needs team coordination)
# ---------------------------------------------------------------------------

def _build_coord_server_config(callback_url: str, relay_token: str) -> dict:
    """Build the team coordination HTTP MCP server config for .mcp.json."""
    return {
        "type": "http",
        "url": f"{callback_url}/mcp",
        "headers": {
            "Authorization": f"Bearer {relay_token}",
        },
    }


# ---------------------------------------------------------------------------
# Shared utilities (any agent type)
# ---------------------------------------------------------------------------

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

    log.info("lifecycle.theme_written", sandbox_id=sandbox_id[:12], token_count=len(tokens))


async def push_secrets_to_agent(runtime: Runtime, sandbox_id: str, agent, secret_envs: dict[str, str]) -> None:
    """
    Hot-reload secrets on a running agent by rewriting files.

    1. Rewrites .mcp.json with updated env blocks (MCP servers re-init on restart)
    2. Writes /mnt/abox-state/secrets/env for immediate shell access
    """
    from django.conf import settings as django_settings

    workspace = "/home/agent"
    adapter = get_adapter(getattr(agent, "agent_type", "claude-code"))

    # Rebuild coord server config if agent has a relay_token
    coord_server = None
    if agent.relay_token:
        callback_url = getattr(django_settings, "ABOX_CALLBACK_URL", "")
        if callback_url:
            coord_server = _build_coord_server_config(callback_url, agent.relay_token)

    if agent.mcp_servers or coord_server:
        mcp_config = adapter.build_mcp_config(
            mcp_servers=agent.mcp_servers, secret_envs=secret_envs,
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
        "lifecycle.secrets_pushed",
        agent_name=agent.name,
        sandbox_id=sandbox_id[:12],
        secret_count=len(secret_envs),
    )
