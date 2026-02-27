"""Claude Code adapter — translates Claude Code stream-json into our vocabulary.

Also owns the provisioning config builders: settings.json and CLAUDE.md.
These are CC-specific formats — other agent types (Gemini, Codex) would have
their own adapters with different file formats and content.

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
    - live_action checks for "result" key: if present, turn is done → empty string
"""

import json
import textwrap


# ---------------------------------------------------------------------------
# CC-specific constants
# ---------------------------------------------------------------------------

# Path where the API key helper script lives in the container
API_KEY_HELPER_PATH = "/opt/abox/api-key-helper.sh"

# Frontend mode → Claude Code permission mode mapping
MODE_TO_PERMISSION = {
    "auto": "bypassPermissions",
    "plan": "plan",
    "supervised": "default",
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


class ClaudeCodeAdapter:
    """Adapter for Claude Code stream-json events and provisioning config."""

    # -- Snapshot extraction (read path) --

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
        return (text_blocks[-1].get("text", "") or "")[:500]

    def live_action(self, snapshot: dict) -> str:
        """Last tool_use name, empty if turn is complete.

        Path: snapshot["assistant"]["message"]["content"][-tool_use-]["name"]
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
        return (tool_blocks[-1].get("name", "") or "")[:500]

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
        """
        content = event.get("message", {}).get("content", [])
        if not isinstance(content, list):
            return None
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            if name == "ExitPlanMode":
                inp = block.get("input", {})
                # Extract plan text from preceding text blocks
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

    # -- Provisioning config (write path) --

    def build_settings(self, *, api_key: str = "", mode: str = "auto") -> str:
        """Build .claude/settings.json content.

        CC-specific: permission modes, disallowed built-in tools, API key helper.
        """
        perm_mode = MODE_TO_PERMISSION.get(mode, "bypassPermissions")
        settings = {
            "theme": "dark",
            "defaultMode": perm_mode,
            "enableAllProjectMcpServers": True,
            # Disable CC's built-in team tools — our MCP `team` server provides
            # the same interface (same params, same semantics) routed through the
            # agentobox backend. This makes our DB the single source of truth for
            # tasks and messages, with no filesystem sync needed.
            "disallowedTools": [
                "TaskCreate", "TaskUpdate", "TaskList", "TaskGet",
                "SendMessage", "TeamCreate", "TeamDelete",
            ],
        }
        if api_key:
            settings["apiKeyHelper"] = API_KEY_HELPER_PATH
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
            - The **team** MCP server provides coordination tools: messaging, tasks,
              spawning teammates. Use these instead of Claude Code's built-in team tools
              (TaskCreate, TaskUpdate, SendMessage, etc. are disabled).
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

                To send messages, use the **team** MCP tools:
                - `send_message(type="message", recipient="name", content="...", summary="...")` — Direct message
                - `send_message(type="broadcast", content="...", summary="...")` — Message all (use sparingly)

                Always refer to teammates by their **name** (e.g. "backend", "frontend").
            """))

        # --- 8. Coordination (lead only) ---
        if is_lead and team_members:
            sections.append(textwrap.dedent("""\
                ## Coordination

                ### Task Management

                Use the **team** MCP tools to coordinate work. These match Claude Code's
                native TaskCreate/TaskUpdate interface:

                - `task_create(subject, description, active_form, metadata)` — Create a task
                - `task_update(task_id, status, owner, ...)` — Update status, claim, set dependencies
                - `task_get(task_id)` — Get full task details
                - `task_list()` — See all tasks and their status
                - `team_status()` — See all active agents and their state

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

                Use the **team** MCP tools to manage your work. These match Claude Code's
                native TaskCreate/TaskUpdate interface:

                - `task_list()` — See tasks assigned to you
                - `task_update(task_id, status="in_progress")` — Claim a task
                - `task_update(task_id, status="completed")` — Mark done
                - `task_get(task_id)` — Get full task details
                - `task_create(subject, description)` — Create new tasks you discover

                When you finish a task, mark it completed and check `task_list` for the
                next one. If you're blocked, message the team lead via `send_message`.
            """))

        # --- 10. How the System Works ---
        sections.append(textwrap.dedent("""\
            ## How the System Works

            Your container runs a **relay process** that streams your activity (tool calls,
            messages, outputs) to the agentobox backend. This is transparent — you don't
            need to do anything special. The dashboard shows your activity in real-time.

            The **team** MCP server provides coordination tools (messaging, tasks,
            spawning). These replace Claude Code's built-in team tools — same interface,
            but routed through the agentobox backend for dashboard visibility.
        """))

        # --- 11. MCP Tool Instructions ---
        if mcp_instructions:
            for instr in mcp_instructions:
                sections.append(instr.strip() + "\n")

        # --- 12. Security ---
        sections.append(SECURITY_INSTRUCTIONS.strip() + "\n")

        return "\n".join(sections)
