"""AgentAdapter Protocol — the port in Ports and Adapters.

Adapters translate between our vocabulary and agent-specific formats.
They own two responsibilities:
    1. Read path — extract display fields from agent events/snapshots
    2. Provisioning — build config files in agent-native format

Live runtime commands (set_mode, set_model) are NOT adapter concerns.
The backend sends our vocabulary to the relay; the relay translates
to SDK calls. This keeps the backend-relay protocol stable.

To add a new agent type (e.g. Codex CLI):
    1. Create adapters/codex/ with __init__.py implementing this protocol
    2. Add registries.py with MODELS_REGISTRY, MCP_REGISTRY, etc.
    3. Register in adapters/__init__.py: _REGISTRY["codex"] = CodexAdapter()
    4. Agent.agent_type routes to the right adapter at runtime.
    All services use get_adapter(agent_type) — no service changes needed.

First principles:
    - Raw events are the only source of truth
    - Adapters are pure functions over JSON — no DB access, no side effects
    - Agent-specific vocabulary (e.g. total_cost_usd, permissionMode) exists
      ONLY inside adapter method bodies
    - Everything after the adapter uses our vocabulary (cost, turns, duration)

Adapters may NOT:
    - Import from agents.models or agents.services
    - Perform database queries
    - Mutate the snapshot dict
    - Raise exceptions (return defaults for missing/malformed data)
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class AgentAdapter(Protocol):
    """Port: translate between our vocabulary and agent-specific formats."""

    # ── Read path (extract from snapshot/event) ──

    def last_output(self, snapshot: dict) -> str:
        """Last assistant text output (~500 chars)."""
        ...

    def live_action(self, snapshot: dict) -> str:
        """Current tool use name, empty if turn is complete."""
        ...

    def cost(self, snapshot: dict) -> float:
        """Session cost in USD from the result event."""
        ...

    def duration(self, snapshot: dict) -> str:
        """Formatted duration string (e.g. '2m 05s')."""
        ...

    def duration_ms(self, snapshot: dict) -> int:
        """Raw duration in milliseconds."""
        ...

    def turns(self, snapshot: dict) -> int:
        """Number of conversation turns."""
        ...

    def is_permission_request(self, event: dict) -> dict | None:
        """Check if an assistant event is a permission request.

        Returns a dict with keys (tool_use_id, command, risk) or None.
        """
        ...

    def is_plan_proposal(self, event: dict) -> dict | None:
        """Check if an assistant event is a plan proposal.

        Returns a dict with keys (tool_use_id, title, plan) or None.
        """
        ...

    def is_message_send(self, event: dict) -> dict | None:
        """Check if an assistant event contains a message send tool call.

        Returns a dict with keys (type, recipient, content, summary) or None.
        Agent types with native team tools (CC) need this because the backend
        doesn't see tool calls that bypass MCP. Agent types using MCP for team
        tools (OpenCode) return None — MCP coord already creates feed items.
        """
        ...

    def wire_to_mode(self, wire_mode: str) -> str:
        """Agent wire format -> our mode. e.g. "bypassPermissions" -> "auto".

        Used by stream.py when parsing system events FROM the agent.
        Returns "" if wire_mode is unrecognized.
        """
        ...

    def mode_to_wire(self, mode: str) -> str:
        """Our mode -> agent wire format. e.g. "auto" -> "bypassPermissions".

        Returns "" if mode is unrecognized.
        """
        ...

    # ── Provisioning paths ──

    def provision_paths(self, workspace: str) -> dict:
        """Agent-type-specific file paths for provisioning.

        Returns a dict of logical names -> filesystem paths.
        Empty string means "skip this file" (agent type doesn't need it).
        provision.py uses these instead of hardcoding CC-specific paths.
        """
        ...

    # ── Provisioning config builders (pure data, no I/O) ──

    def build_settings(self, *, api_key: str = "", mode: str = "auto") -> str:
        """Build agent-type-specific settings file content.

        Returns serialized content (e.g. JSON for Claude Code's settings.json).
        """
        ...

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
        """Build agent-type-specific instruction file content.

        Returns formatted text (e.g. Markdown for Claude Code's CLAUDE.md).
        Adapters own the format — provision.py just writes the output to disk.
        """
        ...

    def build_onboarding_state(self, *, api_key: str = "") -> str:
        """Agent-specific onboarding state. Returns serialized content or ""."""
        ...

    def build_mcp_config(
        self,
        *,
        mcp_servers: dict | None = None,
        secret_envs: dict[str, str] | None = None,
        coord_server: dict | None = None,
    ) -> str:
        """MCP server config file content. e.g. .mcp.json for CC."""
        ...

    def build_api_key_files(self, api_key: str) -> list[dict]:
        """File specs for API key delivery.

        Returns [{path, content, mode, owner}]. Services iterate and write.
        Empty list if no key needed.
        """
        ...

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

        Uses OUR vocabulary for mode (e.g. "auto" not "bypassPermissions").
        The relay translates to SDK format at runtime.
        """
        ...

    # ── Registries (static data) ──

    def available_models(self) -> list[dict]:
        """[{value, label}] of models this agent type supports."""
        ...

    def mcp_registry_entries(self) -> list[dict]:
        """[{name, compat}] of known MCP servers for this agent type."""
        ...

    def resolve_mcp_servers(self, names: list[str], variant: str = "debian") -> dict:
        """Resolve MCP names -> {name: {command, args}} config."""
        ...

    def resolve_mcp_instructions(self, mcp_servers: dict | None) -> list[str]:
        """Instruction strings for resolved MCP servers."""
        ...

    def team_configs(self) -> dict:
        """Team configuration templates."""
        ...
