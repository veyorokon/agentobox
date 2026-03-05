"""OpenCode adapter — translates OpenCode SSE/REST events into our vocabulary.

Also owns provisioning config builders: opencode.json, AGENTS.md, relay env,
and API key delivery. These are OpenCode-specific formats — structurally
different from Claude Code but semantically equivalent.

OpenCode data model (from real v1.2.15 captures):

REST response structure (POST /session/:id/message):
    {
        "info": {
            "role": "assistant",
            "cost": 0.0788,
            "tokens": {"total": 21006, "input": 3, "output": 5, ...},
            "time": {"created": ..., "completed": ...},
            "modelID": "us.anthropic.claude-sonnet-4-6",
            "providerID": "amazon-bedrock",
            "finish": "stop",
            "id": "msg_...",
            "sessionID": "ses_...",
        },
        "parts": [
            {"type": "step-start", ...},
            {"type": "text", "text": "4", ...},
            {"type": "tool", "tool": "write", "state": {"status": "completed", ...}},
            {"type": "step-finish", "cost": 0.0788, "tokens": {...}},
        ]
    }

SSE event types (GET /event):
    - message.part.updated — part state changes (text, tool, step-start/finish)
    - message.updated — full message info updates (cost, tokens, completion)
    - session.status — {type: "busy"} or {type: "idle"}
    - session.idle — deprecated but still fires
    - permission.asked — {id, sessionID, permission, patterns, metadata, tool}
    - permission.replied — {sessionID, requestID, reply}

Snapshot structure (our internal format for OpenCode):
    {
        "message": <latest assistant message.updated info>,
        "parts": [<latest parts from message.part.updated>],
        "idle": <session.idle or session.status idle event>,
    }
"""

import json
import shlex
import structlog
import textwrap

from agents.adapters.opencode.registries import (
    MCP_REGISTRY,
    MODELS_REGISTRY,
    TEAM_CONFIGS,
)

log = structlog.get_logger("abox.adapter.oc")

# ---------------------------------------------------------------------------
# OC-specific constants (private)
# ---------------------------------------------------------------------------

# Path where the API key is stored in the container (root-owned)
_PROXY_KEY_PATH = "/run/secrets/proxy_key"
_PROXY_PORT = 9999

# OpenCode permission mode mapping
# Our vocabulary -> OpenCode permission config value
_MODE_TO_PERMISSION = {
    "auto": "allow",
    "supervised": "ask",
}

# Reverse: OpenCode wire format -> our vocabulary
_PERM_TO_MODE = {
    "allow": "auto",
    "ask": "supervised",
}

# Image variants for AGENTS.md
IMAGE_VARIANTS = {
    "alpine": "Alpine Linux (use `apk` not `apt`)",
    "debian": "Debian Linux (use `apt` not `apk`)",
}

# Security instructions appended to every agent's AGENTS.md
SECURITY_INSTRUCTIONS = """
## Security

NEVER output API keys, secrets, credentials, or tokens in your responses.
If you encounter them in environment variables, files, or process output,
redact them before displaying. This includes API keys, JWT tokens,
GitHub tokens (ghp_*), database passwords, and any high-entropy strings
that look like credentials.

Do NOT attempt to read files in /run/secrets/ or inspect MCP server
process environments. These contain credentials that are intentionally
isolated from your shell.
"""


def _shell_escape(val: str) -> str:
    """Escape a value for safe use in shell export lines."""
    return shlex.quote(val)


class OpenCodeAdapter:
    """Adapter for OpenCode SSE/REST events and provisioning config."""

    # ── Read path (extract from snapshot/event) ──

    def last_output(self, snapshot: dict) -> str:
        """Last text from the assistant message parts.

        Path: snapshot["parts"][-text-]["text"]
        Falls back to snapshot["message"] text parts if present.
        """
        parts = snapshot.get("parts")
        if isinstance(parts, list):
            text_parts = [
                p for p in parts
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            if text_parts:
                return text_parts[-1].get("text", "") or ""

        # Fallback: check info-level parts (from REST response)
        info = snapshot.get("message") or snapshot.get("info")
        if isinstance(info, dict):
            info_parts = info.get("parts", [])
            if isinstance(info_parts, list):
                text_parts = [
                    p for p in info_parts
                    if isinstance(p, dict) and p.get("type") == "text"
                ]
                if text_parts:
                    return text_parts[-1].get("text", "") or ""

        return ""

    def live_action(self, snapshot: dict) -> str:
        """Current tool name if a tool is in pending/running state.

        Path: snapshot["parts"][-tool-]["tool"] where state.status != "completed"
        Returns empty string if no active tool or if session is idle.
        """
        if not snapshot:
            return ""

        # If idle event is present, turn is done
        idle = snapshot.get("idle")
        if idle:
            return ""

        parts = snapshot.get("parts")
        if not isinstance(parts, list):
            return ""

        for part in reversed(parts):
            if not isinstance(part, dict):
                continue
            if part.get("type") != "tool":
                continue
            state = part.get("state", {})
            if not isinstance(state, dict):
                continue
            status = state.get("status", "")
            if status in ("pending", "running"):
                return (part.get("tool", "") or "")[:500]

        return ""

    def cost(self, snapshot: dict) -> float:
        """Session cost from the assistant message info.

        Path: snapshot["message"]["cost"] or step-finish part cost.
        """
        # Primary: message info
        msg = snapshot.get("message") or snapshot.get("info")
        if isinstance(msg, dict):
            val = msg.get("cost")
            if val is not None:
                return float(val or 0)

        # Fallback: last step-finish part
        parts = snapshot.get("parts")
        if isinstance(parts, list):
            for part in reversed(parts):
                if isinstance(part, dict) and part.get("type") == "step-finish":
                    val = part.get("cost")
                    if val is not None:
                        return float(val or 0)

        return 0.0

    def duration(self, snapshot: dict) -> str:
        """Formatted duration from the message time fields.

        Path: snapshot["message"]["time"]["completed"] - snapshot["message"]["time"]["created"]
        """
        ms = self.duration_ms(snapshot)
        if not ms:
            return "0s"
        secs = ms // 1000
        mins = secs // 60
        return f"{mins}m {secs % 60:02d}s" if mins else f"{secs}s"

    def duration_ms(self, snapshot: dict) -> int:
        """Raw duration from the message time fields.

        OpenCode doesn't have a direct duration_ms field. Computed from
        time.completed - time.created on the assistant message info.
        """
        msg = snapshot.get("message") or snapshot.get("info")
        if not isinstance(msg, dict):
            return 0
        time_info = msg.get("time", {})
        if not isinstance(time_info, dict):
            return 0
        created = time_info.get("created")
        completed = time_info.get("completed")
        if created is None or completed is None:
            return 0
        return max(0, int(completed) - int(created))

    def turns(self, snapshot: dict) -> int:
        """Number of conversation turns (steps).

        OpenCode doesn't have a direct turns count. Count step-start parts
        as a proxy, or return 1 if completed.
        """
        parts = snapshot.get("parts")
        if not isinstance(parts, list):
            return 0
        step_starts = [
            p for p in parts
            if isinstance(p, dict) and p.get("type") == "step-start"
        ]
        return len(step_starts)

    def is_permission_request(self, event: dict) -> dict | None:
        """Detect OpenCode permission.asked event.

        OpenCode emits permission requests as SSE events with type
        "permission.asked". Returns extraction dict or None.

        Input is the full SSE event: {type, properties: {id, sessionID, permission, ...}}
        """
        if event.get("type") != "permission.asked":
            return None
        props = event.get("properties", {})
        if not isinstance(props, dict):
            return None

        tool_info = props.get("tool", {})
        metadata = props.get("metadata", {})

        return {
            "tool_use_id": tool_info.get("callID", props.get("id", "")),
            "command": metadata.get("filepath", props.get("permission", "")),
            "risk": props.get("permission", ""),
        }

    def is_plan_proposal(self, event: dict) -> dict | None:
        """OpenCode does not have a plan proposal mechanism.

        Returns None always. OpenCode handles plans internally via agents,
        not via a tool_use pattern like Claude Code's ExitPlanMode.
        """
        return None

    def is_message_send(self, event: dict) -> dict | None:
        """OpenCode uses MCP for team tools — MCP coord creates feed items.

        Returns None always. No stream interception needed.
        """
        return None

    def wire_to_mode(self, wire_mode: str) -> str:
        """OpenCode wire format -> our mode. e.g. "allow" -> "auto"."""
        return _PERM_TO_MODE.get(wire_mode, "")

    def mode_to_wire(self, mode: str) -> str:
        """Our mode -> OpenCode wire format. e.g. "auto" -> "allow"."""
        return _MODE_TO_PERMISSION.get(mode, "")

    # ── Provisioning paths ──

    def provision_paths(self, workspace: str) -> dict:
        """OpenCode file paths for provisioning."""
        return {
            "instruction_file": f"{workspace}/AGENTS.md",
            "settings_file": f"{workspace}/opencode.json",
            "mcp_config_file": f"{workspace}/.mcp.json",
            "onboarding_file": "",  # OpenCode has no onboarding state
            "config_dir": f"{workspace}/.opencode",
            "skills_dir": f"{workspace}/.opencode/plugins",
        }

    # ── Provisioning config builders (pure data, no I/O) ──

    def build_settings(self, *, api_key: str = "", mode: str = "auto", model: str = "") -> str:
        """Build opencode.json content.

        OpenCode-specific: permission config, MCP servers are embedded in
        the main config file (not a separate .mcp.json).
        """
        perm_mode = _MODE_TO_PERMISSION.get(mode, "allow")
        settings: dict = {
            "$schema": "https://opencode.ai/config.json",
            "permission": perm_mode,
        }
        if model:
            settings["model"] = model
        return json.dumps(settings, indent=2)

    def build_instructions(
        self,
        *,
        project_name: str,
        agent_name: str,
        agent_role: str = "worker",
        workspace_path: str = "",
        instructions: str = "",
        team_members: list[dict] | None = None,
        team_name: str = "",
        mcp_instructions: list[str] | None = None,
        variant: str = "debian",
    ) -> str:
        """Build AGENTS.md content for an OpenCode agent.

        OpenCode reads AGENTS.md for project instructions. Same semantic
        sections as Claude Code's CLAUDE.md but references OpenCode tools
        and conventions.
        """
        os_desc = IMAGE_VARIANTS.get(variant, IMAGE_VARIANTS["debian"])
        is_lead = agent_role == "lead"
        sections: list[str] = []

        # --- 1. Identity ---
        role_desc = "the team lead" if is_lead else "a team member"
        sections.append(
            f"# {project_name}\n"
            f"\n"
            f"You are **{agent_name}**, {role_desc} on the **{project_name}** project.\n"
        )

        # --- 2. Platform ---
        sections.append(textwrap.dedent("""\
            ## Platform

            You are running inside an **agentobox** container — a managed platform for
            AI agent teams. Key things to know:

            - Your container has a full Linux desktop (X11), browser, and terminal
            - A relay process streams your activity to the backend — your tool calls,
              messages, and outputs are visible in the dashboard
            - Your workspace is a shared volume — file changes are visible to the host
              and other agents immediately
            - The **team** MCP server provides team coordination tools: `send_message`,
              `task_create`, `task_update`, `task_get`, `task_list`, `team_status`
        """))

        # --- 3. Workspace ---
        if workspace_path:
            sections.append(
                "## Workspace\n"
                "\n"
                "You are working in `/home/agent/workspace` (mounted from host).\n"
                "This is a shared volume — changes you make are visible on the host and\n"
                "to other agents. Stay within this directory for project work.\n"
            )
        else:
            sections.append(
                "## Workspace\n"
                "\n"
                "You are working in `/home/agent`. Stay within this directory.\n"
            )

        # --- 4. Environment ---
        sections.append(
            "## Environment\n"
            "\n"
            f"- OS: {os_desc}\n"
            "- Display: X11 on `:1` (AwesomeWM window manager)\n"
            "- Browser: Firefox ESR (pre-installed)\n"
            "- Backend API: available at env var `ABOX_CALLBACK_URL`\n"
            "- Dashboard: available at env var `ABOX_DASHBOARD_URL`\n"
        )

        # --- 5. Responsibilities ---
        if instructions:
            sections.append(f"## Responsibilities\n\n{instructions.strip()}\n")

        # --- 6. Team roster ---
        if team_members:
            roster = "## Team\n\n"
            for member in team_members:
                name = member.get("name", "unknown")
                role = member.get("role", "worker")
                responsibilities = member.get("instructions", "")
                marker = " (you)" if name == agent_name else ""
                roster += f"- **{name}** ({role}){marker}: {responsibilities}\n"
            sections.append(roster)

        # --- 7. Communication ---
        if team_members:
            sections.append(textwrap.dedent("""\
                ## Communication

                Messages from teammates arrive via the relay. To send messages,
                use the **team** MCP server tools:
                - `send_message(type="message", recipient="name", content="...", summary="...")` — Direct message
                - `send_message(type="broadcast", content="...", summary="...")` — Message all (use sparingly)

                Always refer to teammates by their **name** (e.g. "backend", "frontend").
            """))

        # --- 8. Coordination (lead only) ---
        if is_lead and team_members:
            sections.append(textwrap.dedent("""\
                ## Coordination

                ### Task Management

                Use the **team** MCP server for task coordination:

                - `task_create(subject, description, activeForm, metadata)` — Create a task
                - `task_update(taskId, status, owner, ...)` — Update status, claim, set dependencies
                - `task_get(taskId)` — Get full task details
                - `task_list()` — See all tasks and their status
                - `team_status()` — See all active agents

                ### Spawning Teammates

                To create a new agent, use the `teammate_spawn` MCP tool:

                    teammate_spawn(name="<role>", instructions="<responsibilities>")

                This deploys a new container agent that:
                - Boots in ~30-60 seconds
                - Shares your workspace (same mounted directory)
                - Joins the team — message it via `send_message`
                - Persists until stopped from the dashboard

                Each teammate is a separate container. Spawn when parallel work or
                specialization justifies the overhead.
            """))

        # --- 9. Tasks (worker only) ---
        if not is_lead:
            sections.append(textwrap.dedent("""\
                ## Tasks

                Use the **team** MCP server for task management:

                - `task_list()` — See tasks assigned to you
                - `task_update(taskId, status="in_progress")` — Claim a task
                - `task_update(taskId, status="completed")` — Mark done
                - `task_get(taskId)` — Get full task details
                - `task_create(subject, description)` — Create new tasks you discover

                When you finish a task, mark it completed and check `task_list` for the
                next one. If you're blocked, message the team lead via `send_message`.
            """))

        # --- 10. How the System Works ---
        sections.append(textwrap.dedent("""\
            ## How the System Works

            Your container runs a **relay process** that streams your activity (tool calls,
            messages, outputs) to the agentobox backend via SSE event subscription. This is
            transparent — you don't need to do anything special. The dashboard shows your
            activity in real-time.

            The **team** MCP server provides coordination tools (messaging, tasks, spawning).
            These route through the agentobox backend so the dashboard sees everything.
        """))

        # --- 11. MCP Tool Instructions ---
        if mcp_instructions:
            for instr in mcp_instructions:
                sections.append(instr.strip() + "\n")

        # --- 12. Security ---
        sections.append(SECURITY_INSTRUCTIONS.strip() + "\n")

        return "\n".join(sections)

    def build_onboarding_state(self, *, api_key: str = "") -> str:
        """OpenCode has no onboarding state file. Returns empty string."""
        return ""

    def build_mcp_config(
        self,
        *,
        mcp_servers: dict | None = None,
        secret_envs: dict[str, str] | None = None,
        coord_server: dict | None = None,
    ) -> str:
        """Build MCP config for embedding in opencode.json.

        OpenCode puts MCP config inside the main config file under the "mcp"
        key. Format: {name: {type, command, environment}} for local servers,
        {type: "remote", url, headers} for HTTP servers.

        Returns JSON string of the mcp section to merge into opencode.json.
        This is written as a standalone .mcp.json for compatibility — OpenCode
        also reads project-level .mcp.json files.
        """
        servers = {}
        if mcp_servers:
            for name, config in mcp_servers.items():
                cmd = config.get("command", [])
                if isinstance(cmd, str):
                    cmd = [cmd] + config.get("args", [])
                else:
                    cmd = list(cmd)
                entry: dict = {
                    "type": "local",
                    "command": cmd,
                }
                if secret_envs:
                    entry["environment"] = dict(secret_envs)
                servers[name] = entry

        if coord_server:
            # Coord server is HTTP-based (remote MCP)
            servers["team"] = {
                "type": "remote",
                "url": coord_server.get("url", ""),
                "headers": coord_server.get("headers", {}),
            }

        return json.dumps({"mcpServers": servers}, indent=2)

    def build_api_key_files(self, api_key: str) -> list[dict]:
        """File specs for API key delivery via the localhost proxy.

        Same proxy pattern as Claude Code: real key in /run/secrets/proxy_key,
        proxy intercepts requests and injects the key. OpenCode uses standard
        provider env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) which the
        relay env sets to route through the proxy.
        """
        if not api_key:
            return []
        return [
            {
                "path": _PROXY_KEY_PATH,
                "content": api_key,
                "mode": "0600",
                "owner": "root:root",
            },
        ]

    def build_relay_env(
        self,
        *,
        agent_id: str,
        agent_name: str,
        team_name: str,
        parent_session_id: str,
        callback_url: str,
        relay_token: str,
        api_key: str,
        model: str,
        mode: str,
        resume_session_id: str = "",
        mcp_config_path: str = "",
        allowed_tools: list | None = None,
    ) -> str:
        """Build relay process env file content for OpenCode.

        Uses OUR vocabulary for mode (e.g. "auto" not "allow").
        The relay translates to OpenCode format at runtime.

        OpenCode relay env is similar to CC but with:
        - OPENCODE_PORT instead of SDK-specific vars
        - MODEL in provider/model format
        - AGENT_TYPE=opencode to select the right relay script
        """
        lines = [
            f"export AGENT_ID={_shell_escape(agent_id)}",
            f"export AGENT_NAME={_shell_escape(agent_name)}",
            f"export AGENT_TYPE='opencode'",
            f"export TEAM_NAME={_shell_escape(team_name)}",
            f"export PARENT_SESSION_ID={_shell_escape(parent_session_id)}",
            f"export ABOX_CALLBACK_URL={_shell_escape(callback_url)}",
            f"export RELAY_AUTH_TOKEN={_shell_escape(relay_token)}",
            f"export OPENCODE_MODEL={_shell_escape(model)}",
            f"export AGENT_MODE={_shell_escape(mode)}",
            f"export OPENCODE_PORT='4096'",
        ]

        if api_key:
            # Route through local proxy — provider-specific env vars
            # point to localhost proxy which injects the real key
            provider = model.split("/")[0] if "/" in model else "anthropic"
            # Placeholder keys pass provider format validation while routing
            # through the local proxy which swaps in the real key.
            _PLACEHOLDERS = {
                "anthropic": ("ANTHROPIC_API_KEY", "sk-ant-proxy00-placeholder-for-agentobox"),
                "openai": ("OPENAI_API_KEY", "sk-proxy-placeholder-for-agentobox"),
                "google": ("GEMINI_API_KEY", "proxy-placeholder-for-agentobox"),
            }
            env_key, placeholder = _PLACEHOLDERS.get(provider, ("ANTHROPIC_API_KEY", "proxy-placeholder"))
            base_url_key = env_key.replace("_API_KEY", "_BASE_URL")
            lines.append(f"export {env_key}='{placeholder}'")
            lines.append(f"export {base_url_key}='http://localhost:{_PROXY_PORT}'")

        if resume_session_id:
            lines.append(f"export RESUME_SESSION_ID={_shell_escape(resume_session_id)}")

        if allowed_tools:
            lines.append(f"export ALLOWED_TOOLS={_shell_escape(json.dumps(allowed_tools))}")

        if mcp_config_path:
            lines.append(f"export MCP_CONFIG={_shell_escape(mcp_config_path)}")

        return "\n".join(lines) + "\n"

    # ── Registries (static data) ──

    def available_models(self) -> list[dict]:
        """[{value, label}] of models this agent type supports."""
        return list(MODELS_REGISTRY)

    def mcp_registry_entries(self) -> list[dict]:
        """[{name, compat}] of known MCP servers for this agent type."""
        return [
            {"name": name, "compat": entry.get("compat", [])}
            for name, entry in MCP_REGISTRY.items()
        ]

    def resolve_mcp_servers(self, names: list[str], variant: str = "debian") -> dict:
        """Resolve MCP names -> {name: {command, args}} config.

        Returns OpenCode MCP format: command is a list (not split into
        command + args like CC).
        """
        resolved = {}
        for name in names:
            entry = MCP_REGISTRY.get(name)
            if not entry:
                log.warning("adapter.mcp_unknown_server", server=name)
                continue
            compat = entry.get("compat")
            if compat and variant not in compat:
                log.info("adapter.mcp_incompatible", server=name, variant=variant, compat=compat)
                continue
            resolved[name] = {
                "command": list(entry["command"]),
            }
        return resolved

    def resolve_mcp_instructions(self, mcp_servers: dict | None) -> list[str]:
        """Instruction strings for resolved MCP servers."""
        if not mcp_servers:
            return []
        result = []
        for name in mcp_servers:
            entry = MCP_REGISTRY.get(name, {})
            instr = entry.get("instructions")
            if instr:
                result.append(textwrap.dedent(instr))
        return result

    def team_configs(self) -> dict:
        """Team configuration templates."""
        return dict(TEAM_CONFIGS)
