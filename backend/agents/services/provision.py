"""
Workspace provisioning — write config files into agent containers.

Called during _provision_agent (lifecycle.py) after the container is created.
Writes into the container filesystem via runtime.write_file/exec:

    1. Instruction file — adapter-determined path (CLAUDE.md or AGENTS.md)
    2. Settings file — adapter-determined path and format
    3. MCP config — adapter-determined path (.mcp.json), skipped if empty
    4. Onboarding state — adapter-determined path, skipped if empty
    5. API key files — adapter-provided file specs (path, content, mode, owner)
    6. Scoped sudoers — restricts sudo to package management only
    7. Skills — project skills matching agent tags

All agent-type-specific config (file formats, paths, instruction content) is
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
    model: str = "",
    agent_tags: list[str] | None = None,
) -> None:
    """
    Write instruction file, settings, MCP config, and security
    hardening files into the agent container.

    Delegates agent-type-specific config (settings format, instruction content,
    file paths) to the adapter registered for `agent_type`.

    Args:
        agent_type: Adapter key (e.g. "claude-code", "opencode"). Determines
            settings format, instruction file content, and file paths.
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
    paths = adapter.provision_paths(workspace)
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

    # Build instruction file (e.g. CLAUDE.md, AGENTS.md) via adapter
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
        paths["instruction_file"],
    )

    # Build settings file via adapter
    config_dir = paths["config_dir"]
    await runtime.exec(sandbox_id, ["mkdir", "-p", config_dir])

    settings_content = adapter.build_settings(api_key=api_key, mode=mode, model=model)
    await runtime.write_file(
        sandbox_id,
        settings_content.encode("utf-8"),
        paths["settings_file"],
    )

    # MCP servers config (skipped if adapter returns empty mcp_config_file path).
    # Always write when relay_token is set (team coord server is always injected).
    mcp_config_path = paths["mcp_config_file"]
    coord_server = (
        _build_coord_server_config(callback_url, relay_token)
        if relay_token and callback_url else None
    )
    if mcp_config_path and (mcp_servers or coord_server):
        mcp_config = adapter.build_mcp_config(
            mcp_servers=mcp_servers, secret_envs=secret_envs,
            coord_server=coord_server,
        )
        if mcp_config_path == paths["settings_file"]:
            # Adapter wants MCP merged into the settings file (e.g. OpenCode
            # reads MCP servers from inside opencode.json, not a standalone file).
            merged = json.loads(settings_content)
            merged.update(json.loads(mcp_config))
            merged_content = json.dumps(merged, indent=2)
            await runtime.write_file(
                sandbox_id,
                merged_content.encode("utf-8"),
                mcp_config_path,
            )
        else:
            await runtime.write_file(
                sandbox_id,
                mcp_config.encode("utf-8"),
                mcp_config_path,
            )

    # Write project skills that match this agent's tags
    skills_dir = paths["skills_dir"]
    await _provision_skills(runtime, sandbox_id, project, agent_tags or [], skills_dir, op_log)

    # Mark onboarding complete via adapter (skipped if path is empty)
    onboarding_path = paths["onboarding_file"]
    onboarding_content = adapter.build_onboarding_state(api_key=api_key)
    if onboarding_path and onboarding_content:
        await runtime.write_file(
            sandbox_id,
            onboarding_content.encode("utf-8"),
            onboarding_path,
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
    skills_dir: str,
    op_log,
) -> None:
    """Write project skills matching the agent's tags as <skills_dir>/<name>/SKILL.md."""
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

    await runtime.exec(sandbox_id, ["mkdir", "-p", skills_dir])

    for skill in matching:
        # Sanitize skill name to prevent path traversal
        safe_name = skill.name.replace("/", "_").replace("..", "_").strip(".")
        if not safe_name:
            continue
        skill_dir = f"{skills_dir}/{safe_name}"
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

    Format: export KEY='VALUE' lines, sourced by .bashrc so every Bash tool
    call gets fresh secrets without a restart.

    Uses single quotes to prevent shell expansion — $VAR and $(cmd) stay
    literal. Single quotes inside values are escaped via the standard
    shell idiom: close quote, escaped quote, reopen quote ('\\''). This
    matches the escaping strategy in _shell_escape() in the adapter.

    Used during initial provisioning (lifecycle.py) and hot-reload (push_secrets_to_agent).
    """

    if not secret_envs:
        content = "# Auto-generated by agentobox. No secrets configured.\n"
    else:
        lines = ["# Auto-generated by agentobox. Do not edit."]
        for key, value in secret_envs.items():
            # Single-quote wrapping prevents shell expansion ($, backticks).
            # Only single quotes need escaping inside single-quoted strings.
            escaped = value.replace("'", "'\\''")
            lines.append(f"export {key}='{escaped}'")
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

    1. Rewrites MCP config with updated env blocks (MCP servers re-init on restart)
    2. Writes /mnt/abox-state/secrets/env for immediate shell access
    """
    from django.conf import settings as django_settings

    workspace = "/home/agent"
    adapter = get_adapter(getattr(agent, "agent_type", "claude-code"))
    paths = adapter.provision_paths(workspace)

    # Rebuild coord server config if agent has a relay_token
    coord_server = None
    if agent.relay_token:
        callback_url = getattr(django_settings, "ABOX_CALLBACK_URL", "")
        if callback_url:
            coord_server = _build_coord_server_config(callback_url, agent.relay_token)

    mcp_config_path = paths["mcp_config_file"]
    if mcp_config_path and (agent.mcp_servers or coord_server):
        mcp_config = adapter.build_mcp_config(
            mcp_servers=agent.mcp_servers, secret_envs=secret_envs,
            coord_server=coord_server,
        )
        await runtime.write_file(
            sandbox_id,
            mcp_config.encode("utf-8"),
            mcp_config_path,
        )

    # Write secrets env file for shell access (zero-restart path)
    await write_secrets_env(runtime, sandbox_id, secret_envs)

    log.info(
        "lifecycle.secrets_pushed",
        agent_name=agent.name,
        sandbox_id=sandbox_id[:12],
        secret_count=len(secret_envs),
    )
