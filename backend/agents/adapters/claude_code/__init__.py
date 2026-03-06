"""Claude Code adapter — translates Claude Code stream-json into our vocabulary.

Also owns provisioning config builders: settings.json, CLAUDE.md, .mcp.json,
.claude.json, relay env, and API key delivery. These are CC-specific formats —
other agent types (Gemini, Codex) would have their own adapters with different
file formats and content.

Claude Code snapshot structure:
    {
        "assistant": {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "..."},
                    {"type": "tool_use", "name": "Edit", "id": "...", "input": {...}},
                ]
            }
        },
        "result": {
            "type": "result",
            "duration_ms": 125000,
            "duration_api_ms": 80000,
            "num_turns": 7,
            "total_cost_usd": 0.045,
            "is_error": false,
            "session_id": "...",
            ...
        }
    }

Semantics:
    - New assistant event pops "result" (new turn started)
    - Result event adds "result" (turn complete)
    - live_action checks for "result" key: if present, turn is done -> empty string
"""

import json
import shlex
import structlog
import textwrap

from agents.adapters.claude_code.registries import (
    MCP_REGISTRY,
    MODELS_REGISTRY,
    PROVIDER_CONFIGS,
    TEAM_CONFIGS,
)

log = structlog.get_logger("abox.adapter.cc")

# ---------------------------------------------------------------------------
# CC-specific constants (private — services never import these directly)
# ---------------------------------------------------------------------------

# Path where the API key helper script lives in the container
_API_KEY_HELPER_PATH = "/opt/abox/api-key-helper.sh"

# Placeholder key for API proxy mode — must match sk-ant-* pattern for CC CLI validation
_PROXY_PLACEHOLDER_KEY = "sk-ant-proxy00-placeholder-key-for-agentobox-validation"
_PROXY_KEY_PATH = "/run/secrets/proxy_key"
_PROXY_PORT = 9999

# Frontend mode -> Claude Code permission mode mapping
# Internal to adapter — used by build_settings() and build_relay_env().
# Services send our vocabulary; the relay translates to SDK format at runtime.
_MODE_TO_PERMISSION = {
    "auto": "bypassPermissions",
    "plan": "plan",
    "supervised": "default",
}

# Reverse: Claude Code wire format -> our vocabulary
# Used by wire_to_mode() when parsing system events FROM the agent.
_PERM_TO_MODE = {
    "bypassPermissions": "auto",
    "dontAsk": "auto",
    "plan": "plan",
    "default": "supervised",
    "acceptEdits": "supervised",
}

# Image variants and their OS descriptions for CLAUDE.md
IMAGE_VARIANTS = {
    "alpine": "Alpine Linux (use `apk` not `apt`)",
    "debian": "Debian Linux (use `apt` not `apk`)",
}

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


def _shell_escape(val: str) -> str:
    """Escape a value for safe use in shell export lines.

    Delegates to shlex.quote() which wraps in single quotes and handles
    all shell metacharacters (quotes, $, backticks, spaces, etc.).
    Returns the fully-quoted string including outer quotes.
    """
    return shlex.quote(val)


def _basename(path: str) -> str:
    """Extract filename from a path, handling both / and \\ separators."""
    return path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]


def _tool_input_summary(tool_name: str, tool_input: object) -> str:
    """Extract a brief context string from a tool_use input dict.

    Returns a short human-readable suffix like "base.py" or "npm test".
    Empty string if no useful context can be extracted.
    """
    if not isinstance(tool_input, dict):
        return ""

    # File-oriented tools: show basename
    file_path = tool_input.get("file_path") or tool_input.get("path") or ""
    if file_path and isinstance(file_path, str):
        return _basename(file_path)

    # Bash/command tools: show first ~60 chars of command
    command = tool_input.get("command") or ""
    if command and isinstance(command, str):
        # Trim to first line and cap length
        first_line = command.split("\n", 1)[0].strip()
        return first_line[:60]

    # Search tools (Grep, Glob): show pattern
    pattern = tool_input.get("pattern") or ""
    if pattern and isinstance(pattern, str):
        return pattern[:60]

    # MCP tools: show query if present
    query = tool_input.get("query") or ""
    if query and isinstance(query, str):
        return query[:60]

    return ""


# Display name → CC model ID. Catches bad data from seed scripts or manual DB edits.
_MODEL_DISPLAY_TO_ID = {
    "opus 4.6": "claude-opus-4-6",
    "sonnet 4.6": "claude-sonnet-4-6",
    "sonnet 4.5": "claude-sonnet-4-5-20250929",
    "haiku 4.5": "claude-haiku-4-5-20251001",
}


def _normalize_model_id(model: str) -> str:
    """Normalize a model string to a CC-compatible model ID.

    Accepts:
    - Proper Anthropic IDs: ``claude-opus-4-6`` → pass through
    - Display names: ``Opus 4.6`` → lookup in _MODEL_DISPLAY_TO_ID
    - Provider-prefixed: ``glm/glm-5`` → strip prefix, return ``glm-5``

    For provider-prefixed models, the prefix is only used for proxy routing
    (see build_relay_env). CC receives just the model ID portion.
    """
    if "/" in model:
        return model.split("/", 1)[1]
    if model.startswith("claude-"):
        return model
    return _MODEL_DISPLAY_TO_ID.get(model.lower(), model)


class ClaudeCodeAdapter:
    """Adapter for Claude Code stream-json events and provisioning config."""

    native_is_canonical = True

    # ── Normalization ──

    def normalize(self, event: dict, state: dict) -> list[dict]:
        """Identity — CC events are already in CC format."""
        return [event]

    # ── Read path (extract from snapshot/event) ──

    def last_output(self, snapshot: dict) -> str:
        """Last text block from the assistant event.

        Path: snapshot["assistant"]["message"]["content"][-text-]["text"]
        """
        assistant = snapshot.get("assistant")
        if not assistant:
            return ""
        content = assistant.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return ""
        text_blocks = [
            b for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        if not text_blocks:
            return ""
        return text_blocks[-1].get("text", "") or ""

    def live_action(self, snapshot: dict) -> str:
        """Tool name + brief context from input, empty if turn is complete.

        Examples: "Read base.py", "Edit auth.ts", "Bash npm test", "Grep pattern"

        Path: snapshot["assistant"]["message"]["content"][-tool_use-]
        Clears implicitly: if snapshot["result"] exists, turn is done.
        """
        if not snapshot or "result" in snapshot:
            return ""
        assistant = snapshot.get("assistant")
        if not assistant:
            return ""
        content = assistant.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return ""
        tool_types = ("tool_use", "server_tool_use", "mcp_tool_use")
        tool_blocks = [
            b for b in content
            if isinstance(b, dict) and b.get("type") in tool_types
        ]
        if not tool_blocks:
            return ""
        block = tool_blocks[-1]
        name = (block.get("name", "") or "")[:100]
        if not name:
            return ""
        summary = _tool_input_summary(name, block.get("input"))
        if summary:
            return f"{name} {summary}"[:500]
        return name

    def cost(self, snapshot: dict) -> float:
        """Session cost from the result event.

        Path: snapshot["result"]["total_cost_usd"]
        """
        result = snapshot.get("result")
        if not result:
            return 0.0
        return float(result.get("total_cost_usd", 0) or 0)

    def duration(self, snapshot: dict) -> str:
        """Formatted duration from the result event.

        Path: snapshot["result"]["duration_ms"]
        """
        ms = self.duration_ms(snapshot)
        if not ms:
            return "0s"
        secs = ms // 1000
        mins = secs // 60
        return f"{mins}m {secs % 60:02d}s" if mins else f"{secs}s"

    def duration_ms(self, snapshot: dict) -> int:
        """Raw duration from the result event.

        Path: snapshot["result"]["duration_ms"]
        """
        result = snapshot.get("result")
        if not result:
            return 0
        return int(result.get("duration_ms", 0) or 0)

    def turns(self, snapshot: dict) -> int:
        """Number of turns from the result event.

        Path: snapshot["result"]["num_turns"]
        """
        result = snapshot.get("result")
        if not result:
            return 0
        return int(result.get("num_turns", 0) or 0)

    def is_permission_request(self, event: dict) -> dict | None:
        """Detect AskHuman permission tool_use in assistant event.

        Claude Code emits permission requests as tool_use blocks with
        specific tool names. Returns extraction dict or None.
        """
        content = event.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return None
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") not in ("tool_use", "server_tool_use"):
                continue
            inp = block.get("input", {})
            if not isinstance(inp, dict):
                continue
            # Claude Code permission pattern: tool_use with commandInput
            if "commandInput" in inp or "command" in inp:
                return {
                    "tool_use_id": block.get("id", ""),
                    "command": inp.get("command", inp.get("commandInput", "")),
                    "risk": inp.get("risk", ""),
                }
        return None

    def is_plan_proposal(self, event: dict) -> dict | None:
        """Detect plan proposal in assistant event.

        Claude Code emits plan proposals via ExitPlanMode tool_use.
        Plan text lives in the tool input (input.plan), with preceding
        text blocks as fallback.
        """
        content = event.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return None
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "tool_use":
                continue
            if block.get("name") != "ExitPlanMode":
                continue

            # Primary: plan text from tool input (how CC actually sends it)
            tool_input = block.get("input", {})
            plan_text = tool_input.get("plan", "") if isinstance(tool_input, dict) else ""

            # Fallback: preceding text blocks in the same message
            if not plan_text:
                text_blocks = [
                    b.get("text", "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ]
                plan_text = "\n".join(text_blocks)

            return {
                "tool_use_id": block.get("id", ""),
                "title": "Implementation Plan",
                "plan": plan_text,
            }
        return None

    def is_message_send(self, event: dict) -> dict | None:
        """Detect SendMessage tool_use in assistant event.

        CC's native SendMessage tool doesn't trigger PostToolUse hooks,
        so the hook bridge never fires. Stream interception catches it here.
        # tech-debt: remove if CC ever fires PostToolUse for native team tools
        """
        content = event.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return None
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "tool_use":
                continue
            if block.get("name") != "SendMessage":
                continue

            tool_input = block.get("input", {})
            if not isinstance(tool_input, dict):
                continue

            msg_type = tool_input.get("type", "")
            if msg_type not in ("message", "broadcast", "shutdown_request"):
                continue

            return {
                "type": msg_type,
                "recipient": tool_input.get("recipient", ""),
                "content": tool_input.get("content", ""),
                "summary": tool_input.get("summary", ""),
            }
        return None

    def wire_to_mode(self, wire_mode: str) -> str:
        """Agent wire format -> our mode. e.g. "bypassPermissions" -> "auto".

        Used by stream.py when parsing system events FROM the agent.
        Returns "" if wire_mode is unrecognized.
        """
        return _PERM_TO_MODE.get(wire_mode, "")

    def mode_to_wire(self, mode: str) -> str:
        """Our mode -> agent wire format. e.g. "auto" -> "bypassPermissions"."""
        return _MODE_TO_PERMISSION.get(mode, "")

    # ── Provisioning paths ──

    def provision_paths(self, workspace: str) -> dict:
        """Claude Code file paths for provisioning."""
        return {
            "instruction_file": f"{workspace}/CLAUDE.md",
            "settings_file": f"{workspace}/.claude/settings.json",
            "mcp_config_file": f"{workspace}/.mcp.json",
            "onboarding_file": f"{workspace}/.claude.json",
            "config_dir": f"{workspace}/.claude",
            "skills_dir": f"{workspace}/.claude/skills",
        }

    # ── Provisioning config builders (pure data, no I/O) ──

    def build_settings(self, *, api_key: str = "", mode: str = "auto", model: str = "") -> str:
        """Build .claude/settings.json content.

        CC-specific: permission modes, hooks for team tool interception,
        API key helper. Team lifecycle tools (TeamCreate/TeamDelete) stay
        disabled — the platform manages team creation. All other team tools
        are intercepted by hooks and routed through the agentobox backend.
        """
        perm_mode = _MODE_TO_PERMISSION.get(mode, "bypassPermissions")
        hook_cmd = "python3 /opt/abox/hooks/team-bridge.py"
        settings = {
            "theme": "dark",
            "defaultMode": perm_mode,
            "enableAllProjectMcpServers": True,
            # Only disable team lifecycle — hooks bridge the rest
            "disallowedTools": ["TeamCreate", "TeamDelete"],
            "hooks": {
                # Read-only tools: intercept before CC writes local files.
                # Hook denies the native tool and returns backend result via
                # systemMessage — no local file infrastructure needed.
                "PreToolUse": [
                    {
                        "matcher": "TaskList|TaskGet",
                        "hooks": [{"type": "command", "command": hook_cmd, "timeout": 15}],
                    },
                ],
                # Mutating tools: intercept after CC executes. The native tool
                # writes local files (harmless), then our hook forwards to
                # backend so the DB is the source of truth.
                "PostToolUse": [
                    {
                        "matcher": "SendMessage|TaskCreate|TaskUpdate",
                        "hooks": [{"type": "command", "command": hook_cmd, "timeout": 15}],
                    },
                ],
            },
        }
        if api_key:
            settings["apiKeyHelper"] = _API_KEY_HELPER_PATH
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
        """Build CLAUDE.md content for a Claude Code agent.

        CC-specific: Markdown format, references to MCP team tools, CC-native
        tool names, permission modes, relay architecture.
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
            - Your native team tools (SendMessage, TaskCreate, TaskUpdate, TaskGet,
              TaskList) work normally — hooks route them through the agentobox backend
              so messages and tasks are visible in the dashboard
            - The **team** MCP server provides additional tools: `teammate_spawn`,
              `team_status`, and the same messaging/task tools as an alternative path
            - Your workspace is a shared volume — file changes are visible to the host
              and other agents immediately
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

                Messages from teammates arrive as regular user turns prefixed with the
                sender's name, e.g. `[Team message from team-lead]: ...`. Messages are
                delivered to you automatically via stdin.

                To send messages, use your native SendMessage tool or the **team** MCP
                `send_message` — both work identically:
                - `type="message", recipient="name", content="...", summary="..."` — Direct message
                - `type="broadcast", content="...", summary="..."` — Message all (use sparingly)

                Always refer to teammates by their **name** (e.g. "backend", "frontend").
            """))

        # --- 8. Coordination (lead only) ---
        if is_lead and team_members:
            sections.append(textwrap.dedent("""\
                ## Coordination

                ### Task Management

                Your native task tools work — hooks route them through the backend:

                - `TaskCreate(subject, description, activeForm, metadata)` — Create a task
                - `TaskUpdate(taskId, status, owner, ...)` — Update status, claim, set dependencies
                - `TaskGet(taskId)` — Get full task details
                - `TaskList()` — See all tasks and their status

                The **team** MCP also has `team_status()` — see all active agents.

                ### Spawning Teammates

                To create a new agent, use the `teammate_spawn` MCP tool:

                    teammate_spawn(name="<role>", instructions="<responsibilities>")

                This deploys a new container agent that:
                - Boots in ~30-60 seconds
                - Shares your workspace (same mounted directory)
                - Joins the team — message it via `send_message`
                - Persists until stopped from the dashboard

                **Important:**
                - Do NOT create `.claude/agents/` files — they don't work in this environment
                - Each teammate is a separate container. Spawn when parallel work or
                  specialization justifies the overhead.
            """))

        # --- 9. Tasks (worker only) ---
        if not is_lead:
            sections.append(textwrap.dedent("""\
                ## Tasks

                Your native task tools work — hooks route them through the backend:

                - `TaskList()` — See tasks assigned to you
                - `TaskUpdate(taskId, status="in_progress")` — Claim a task
                - `TaskUpdate(taskId, status="completed")` — Mark done
                - `TaskGet(taskId)` — Get full task details
                - `TaskCreate(subject, description)` — Create new tasks you discover

                When you finish a task, mark it completed and check `TaskList` for the
                next one. If you're blocked, message the team lead via `SendMessage`.
            """))

        # --- 10. How the System Works ---
        sections.append(textwrap.dedent("""\
            ## How the System Works

            Your container runs a **relay process** that streams your activity (tool calls,
            messages, outputs) to the agentobox backend. This is transparent — you don't
            need to do anything special. The dashboard shows your activity in real-time.

            Your native team tools (SendMessage, TaskCreate, etc.) are intercepted by
            hooks and routed through the backend — the dashboard sees everything. The
            **team** MCP server provides the same tools plus extras (teammate_spawn,
            team_status). Both paths converge on the backend DB.
        """))

        # --- 11. MCP Tool Instructions ---
        if mcp_instructions:
            for instr in mcp_instructions:
                sections.append(instr.strip() + "\n")

        # --- 12. Security ---
        sections.append(SECURITY_INSTRUCTIONS.strip() + "\n")

        return "\n".join(sections)

    def build_onboarding_state(self, *, api_key: str = "") -> str:
        """Build .claude.json content — marks onboarding complete, pre-approves API key.

        CC-specific: Claude Code reads .claude.json on startup. Without this,
        it prompts interactively for onboarding and API key approval.

        Pre-approves the PLACEHOLDER key (not the real one) so CC validates
        the placeholder at startup. The API proxy handles injecting the real
        key into upstream requests.
        """
        state = {
            "hasCompletedOnboarding": True,
            "bypassPermissionsModeAccepted": True,
        }
        if api_key:
            state["customApiKeyResponses"] = {
                "approved": [_PROXY_PLACEHOLDER_KEY[-20:]],
                "rejected": [],
            }
        return json.dumps(state)

    def build_mcp_config(
        self,
        *,
        mcp_servers: dict | None = None,
        secret_envs: dict[str, str] | None = None,
        coord_server: dict | None = None,
    ) -> str:
        """Build .mcp.json content with secrets injected into every server's env block.

        CC-specific: Claude Code reads .mcp.json for MCP server configs.
        The format is {"mcpServers": {name: {command, args, env}}}.

        All project secrets are merged flat and injected into every MCP server's
        env block. MCP servers ignore keys they don't recognize, so extra keys
        are harmless. This avoids needing per-server secret routing.
        """
        servers = {}
        if mcp_servers:
            for name, config in mcp_servers.items():
                entry = {"command": config["command"], "args": config.get("args", [])}
                if secret_envs:
                    entry["env"] = dict(secret_envs)
                servers[name] = entry

        if coord_server:
            servers["team"] = coord_server

        return json.dumps({"mcpServers": servers}, indent=2)

    def build_api_key_files(self, api_key: str) -> list[dict]:
        """File specs for API key delivery via the localhost proxy.

        Returns [{path, content, mode, owner}]. Services iterate and write.
        Empty list if no key needed.

        The real key is written to /run/secrets/proxy_key (0600 root:root)
        where only the root-owned api-proxy.py can read it. The apiKeyHelper
        script echoes a placeholder key that CC CLI validates at startup.
        The proxy strips the placeholder and injects the real key before
        forwarding to api.anthropic.com.
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
            {
                "path": _API_KEY_HELPER_PATH,
                "content": f"#!/bin/bash\necho '{_PROXY_PLACEHOLDER_KEY}'\n",
                "mode": "0555",
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
        """Build relay process env file content.

        Single source of truth for relay environment variables.
        Uses OUR vocabulary for mode (e.g. "auto" not "bypassPermissions").
        The relay translates to SDK format at runtime. This keeps the
        backend-relay protocol stable across agent types.

        Proxy partnership (Layer 2 secret protection):
          When api_key is provided, TWO env vars work together:
          - ANTHROPIC_API_KEY = placeholder (passes CLI format validation)
          - ANTHROPIC_BASE_URL = http://localhost:9999 (routes to proxy)
          The Claude CLI sends the placeholder to localhost:9999. The proxy
          (svc-apiproxy, running as root) strips it and injects the real key
          from /run/secrets/proxy_key before forwarding to api.anthropic.com.
          Result: the real key never appears in the relay's env, memory, or logs.
        """
        # Proxy active: relay gets a placeholder key that passes CLI validation.
        # The real key lives in /run/secrets/proxy_key, read by svc-apiproxy.
        relay_api_key = _PROXY_PLACEHOLDER_KEY if api_key else ""

        lines = [
            f"export AGENT_ID={_shell_escape(agent_id)}",
            f"export AGENT_NAME={_shell_escape(agent_name)}",
            f"export TEAM_NAME={_shell_escape(team_name)}",
            f"export PARENT_SESSION_ID={_shell_escape(parent_session_id)}",
            f"export ABOX_CALLBACK_URL={_shell_escape(callback_url)}",
            f"export RELAY_AUTH_TOKEN={_shell_escape(relay_token)}",
            f"export ANTHROPIC_API_KEY={_shell_escape(relay_api_key)}",
            f"export CLAUDE_MODEL={_shell_escape(_normalize_model_id(model))}",
            f"export AGENT_MODE={_shell_escape(mode)}",
        ]

        if api_key:
            lines.append(
                f"export ANTHROPIC_BASE_URL='http://localhost:{_PROXY_PORT}'"
            )

        # Provider-prefixed models: emit proxy env vars for svc-apiproxy.
        # The proxy uses these to route to the correct upstream and handle
        # thinking block translation.
        if "/" in model:
            provider = model.split("/", 1)[0]
            pconfig = PROVIDER_CONFIGS.get(provider)
            if pconfig:
                lines.append(f"export PROXY_UPSTREAM_HOST={_shell_escape(pconfig['proxy_host'])}")
                lines.append(f"export PROXY_UPSTREAM_PORT={_shell_escape(str(pconfig['proxy_port']))}")
                lines.append(f"export PROXY_AUTH_HEADER={_shell_escape(pconfig['auth_header'])}")
                lines.append(f"export PROXY_THINKING_MODE={_shell_escape(pconfig['thinking_mode'])}")
                if pconfig.get("path_prefix"):
                    lines.append(f"export PROXY_PATH_PREFIX={_shell_escape(pconfig['path_prefix'])}")

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

        Skips servers incompatible with the given image variant.
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
                "command": entry["command"],
                "args": entry["args"],
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
