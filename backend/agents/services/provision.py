"""
Workspace provisioning — write config files to the agent volume.

Called during _provision_agent (lifecycle.py) after the container is created.
Writes to the shared volume via Volume.write() — no runtime.exec() or
runtime.write_file() needed for config state. The init-volume oneshot
creates symlinks so the container sees these files at their canonical paths.

    1. Instruction file — adapter-determined content (CLAUDE.md)
    2. Settings file — adapter-determined format
    3. MCP config — .mcp.json, skipped if empty
    4. Onboarding state — .claude.json, skipped if empty
    5. Skills — project skills matching agent tags
    6. MCP Gateway config — commands + ports, no secrets
    7. Per-MCP scoped secrets — /run/secrets/mcp-{name}/{KEY}

Security hardening (API key files, scoped sudo) still uses runtime.exec()
because those operate on system paths (/opt/abox/, /etc/sudoers.d/) that
are not on the volume.

Volume path convention (Mirror, Don't Map):
    Volume paths mirror container filesystem paths exactly. A file at
    vol.write("home/agent/.claude/settings.json", ...) appears at
    /home/agent/.claude/settings.json inside the container via symlink.
"""
import json

import structlog

from agents.adapters import get_adapter
from agents.runtimes.base import Runtime
from agents.services.volume import AgentMachine
from projects.models import Project

log = structlog.get_logger("abox.lifecycle")


# ---------------------------------------------------------------------------
# Volume path helpers — translate adapter paths to volume-relative paths
# ---------------------------------------------------------------------------

def _container_to_vol(container_path: str) -> str:
    """Convert an absolute container path to a volume-relative path.

    e.g. "/home/agent/.claude/settings.json" → "home/agent/.claude/settings.json"
         "/home/agent/workspace/CLAUDE.md"   → "home/agent/workspace/CLAUDE.md"

    Adapter paths are absolute container paths. The volume mirrors the
    container filesystem, so we just strip the leading slash.
    """
    return container_path.lstrip("/")


async def provision_workspace(
    vol: AgentMachine,
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
    """Write config files to the agent volume.

    All agent-type-specific config (settings format, instruction content,
    file paths) is delegated to the adapter. This function handles the
    I/O orchestration — writing each piece to the volume at the correct
    mirror path.

    Args:
        vol: AgentMachine instance for this agent (from agent.machine)
        project: Project the agent belongs to
        agent_type: Adapter key (e.g. "claude-code")
        api_key: Resolved API key for the model's provider
        secret_envs: Flat {key: value} dict of decrypted project secrets
        agent_role: "lead" or "worker"
        agent_name: This agent's name (for team context)
        team_members: List of team member dicts for instruction file roster
        team_name: Team name for lead's spawning instructions
        agent_tags: Tags for skill matching
    """
    adapter = get_adapter(agent_type)
    op_log = log.bind(project_id=str(project.id))
    workspace = "/home/agent/workspace"
    paths = adapter.provision_paths(workspace)
    op_log.info(
        "lifecycle.provisioning_workspace",
        context_path=workspace,
        variant=variant,
        workspace_path=workspace_path,
        agent_type=agent_type,
    )

    # Resolve MCP instruction strings via adapter
    mcp_instr = adapter.resolve_mcp_instructions(mcp_servers)

    # Build and write instruction file (e.g. CLAUDE.md)
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
    vol.write(_container_to_vol(paths["instruction_file"]), instruction_content)

    # Build and write settings file
    settings_content = adapter.build_settings(api_key=api_key, mode=mode, model=model)
    vol.write(_container_to_vol(paths["settings_file"]), settings_content)

    # MCP servers config — the adapter determines where MCP config lives
    # (separate .mcp.json or merged into settings). Config is written when:
    #   - Agent has user-configured MCP servers, OR
    #   - Agent has a relay_token (team coord server is always injected)
    # Skipped entirely if the adapter returns an empty mcp_config_file path.
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
            # Adapter returns same path for MCP and settings → merge into one file
            merged = json.loads(settings_content)
            merged.update(json.loads(mcp_config))
            vol.write(_container_to_vol(mcp_config_path), json.dumps(merged, indent=2))
        else:
            vol.write_workspace_mcp_config(mcp_config)

    # MCP Gateway config (commands + ports, no secrets)
    if mcp_servers and hasattr(adapter, "build_gateway_config"):
        gateway_config = adapter.build_gateway_config(mcp_servers=mcp_servers)
        vol.write_gateway_config(gateway_config)

        # Write per-MCP scoped secrets to volume
        if secret_envs:
            for name, config in mcp_servers.items():
                needed = config.get("secrets", [])
                if not needed:
                    continue
                for key in needed:
                    if key in secret_envs:
                        vol.write_mcp_secret(name, key, secret_envs[key])

    # Prevent host .mcp.json from bleeding through workspace bind mount.
    # Each agent gets its own .mcp.json on the volume; the workspace
    # bind-mount's .mcp.json is masked by the volume symlink.
    if workspace_path:
        vol.write_workspace_mcp_config('{"mcpServers": {}}')

    # Write project skills that match this agent's tags
    skills_dir = paths["skills_dir"]
    await _provision_skills_to_volume(vol, project, agent_tags or [], skills_dir, op_log)

    # Mark onboarding complete via adapter (skipped if path is empty)
    onboarding_path = paths["onboarding_file"]
    onboarding_content = adapter.build_onboarding_state(api_key=api_key)
    if onboarding_path and onboarding_content:
        vol.write(_container_to_vol(onboarding_path), onboarding_content)

    # Write API key files to volume (proxy_key, api-key-helper.sh)
    _provision_api_key_files_to_volume(vol, adapter.build_api_key_files(api_key), op_log)

    op_log.info("lifecycle.workspace_provisioned")


# ---------------------------------------------------------------------------
# API key file provisioning
# ---------------------------------------------------------------------------

def _provision_api_key_files_to_volume(
    vol: AgentMachine, file_specs: list[dict], op_log,
) -> None:
    """Write API key files to the volume from adapter-provided specs.

    Each spec is {path, content, mode, owner}. Files under /run/secrets/
    get restricted permissions via write_secret().
    """
    if not file_specs:
        op_log.warning("lifecycle.api_key_skipped", reason="no api key")
        return

    for spec in file_specs:
        vol_path = _container_to_vol(spec["path"])
        mode_str = spec.get("mode", "0644")
        mode_int = int(mode_str, 8)
        if mode_int <= 0o600:
            vol.write_secret(vol_path, spec["content"], mode=mode_int)
        else:
            vol.write(vol_path, spec["content"])

    op_log.info("lifecycle.api_key_provisioned")


# ---------------------------------------------------------------------------
# Scoped sudo — still uses runtime.exec() (system path, not volume)
# ---------------------------------------------------------------------------

async def provision_scoped_sudo(
    runtime: Runtime, sandbox_id: str, op_log,
) -> None:
    """Replace blanket NOPASSWD sudo with package-manager-only access.

    This is the one remaining runtime.exec() call — /etc/sudoers.d/ is a
    system directory that's not on the volume. It must be written inside
    the container with proper ownership.
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
    await runtime.exec(
        sandbox_id,
        ["bash", "-c", "sed -i '/agent.*NOPASSWD.*ALL$/d' /etc/sudoers"],
        user="root",
    )

    op_log.info("lifecycle.sudo_provisioned")


# ---------------------------------------------------------------------------
# Skill provisioning (volume-based)
# ---------------------------------------------------------------------------

async def _provision_skills_to_volume(
    vol: AgentMachine,
    project: Project,
    agent_tags: list[str],
    skills_dir: str,
    op_log,
) -> None:
    """Write project skills matching the agent's tags to the volume.

    Skills are written as <skills_dir>/<name>/SKILL.md. The skills_dir
    path is an absolute container path from the adapter; we convert it
    to a volume-relative path.

    Uses sync_to_async for the ORM query because this runs in a detached
    asyncio.create_task where the original HTTP request's executor is dead.
    """
    from asgiref.sync import sync_to_async
    from agents.models import Skill
    from agents.utils import sanitize_skill_name

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

    vol_skills_dir = _container_to_vol(skills_dir)

    for skill in matching:
        safe_name = sanitize_skill_name(skill.name)
        if not safe_name:
            continue
        vol.write(f"{vol_skills_dir}/{safe_name}/SKILL.md", skill.content)

    op_log.info("lifecycle.skills_provisioned", count=len(matching))


# ---------------------------------------------------------------------------
# Coord server config (generic — any agent type needs team coordination)
# ---------------------------------------------------------------------------

def _build_coord_server_config(callback_url: str, relay_token: str) -> dict:
    """Build the team coordination SSE MCP server config for .mcp.json.

    type="sse" matches the backend's FastMCP SSE transport. Do NOT use
    "http" (wrong protocol) or omit type (CC 2.x can't auto-detect).
    """
    return {
        "type": "sse",
        "url": f"{callback_url}/mcp",
        "headers": {
            "Authorization": f"Bearer {relay_token}",
        },
    }


# ---------------------------------------------------------------------------
# Secrets env content builder (used by lifecycle.py and hot-reload)
# ---------------------------------------------------------------------------

def build_secrets_env_content(secret_envs: dict[str, str] | None) -> str:
    """Build shell-sourceable secrets content.

    Format: export KEY='VALUE' lines. Single quotes prevent shell expansion.
    Single quotes inside values are escaped via the standard shell idiom:
    close quote, escaped quote, reopen quote ('\\'').

    Returns the full file content as a string. Caller writes to volume.
    """
    if not secret_envs:
        return "# Auto-generated by agentobox. No secrets configured.\n"

    lines = ["# Auto-generated by agentobox. Do not edit."]
    for key, value in secret_envs.items():
        escaped = value.replace("'", "'\\''")
        lines.append(f"export {key}='{escaped}'")
    return "\n".join(lines) + "\n"


async def push_secrets_to_agent(agent, secret_envs: dict[str, str]) -> None:
    """Hot-reload secrets on a running agent via volume write + reload.

    Replaces the old runtime.write_file + runtime.exec approach.
    Writes secrets to volume, rebuilds MCP config, then reloads the relay.
    """
    from agents.services.relay import push_to_relay
    from agents.services.relay_commands import ReloadCommand

    vol = agent.machine
    adapter = get_adapter(getattr(agent, "agent_type", "claude-code"))
    workspace = "/home/agent/workspace"
    paths = adapter.provision_paths(workspace)

    # Rebuild coord server config if agent has a relay_token
    coord_server = None
    if agent.relay_token:
        from config.app_config import app_config as _cfg
        callback_url = _cfg.callback_url
        if callback_url:
            coord_server = _build_coord_server_config(callback_url, agent.relay_token)

    # Rewrite MCP config with updated env blocks
    mcp_config_path = paths["mcp_config_file"]
    if mcp_config_path and (agent.mcp_servers or coord_server):
        mcp_config = adapter.build_mcp_config(
            mcp_servers=agent.mcp_servers, secret_envs=secret_envs,
            coord_server=coord_server,
        )
        vol.write(_container_to_vol(mcp_config_path), mcp_config)

    # Write secrets env file
    vol.write_secrets_env_document(build_secrets_env_content(secret_envs))

    # Rewrite per-MCP scoped secrets
    mcp_servers = agent.mcp_servers
    if mcp_servers and secret_envs:
        for name, config in mcp_servers.items():
            needed = config.get("secrets", [])
            if not needed:
                continue
            for key in needed:
                if key in secret_envs:
                    vol.write_mcp_secret(name, key, secret_envs[key])
        # Reload gateway config
        await push_to_relay(str(agent.id), ReloadCommand(path="run/mcp-gateway/config.json"))

    log.info(
        "lifecycle.secrets_pushed",
        agent_name=agent.name,
        secret_count=len(secret_envs),
    )
