"""Adapter registry — maps agent_type strings to AgentAdapter instances.

Public API:
    get_adapter(agent_type) -> AgentAdapter
    register_adapter(agent_type, adapter) -> None

Auto-registers built-in adapters on import.

To add a new agent type:
    1. Create adapters/<name>/ package implementing AgentAdapter
    2. Import and register here: register_adapter("<name>", <Adapter>())
"""

from agents.adapters.base import AgentAdapter
from agents.adapters.claude_code import ClaudeCodeAdapter
from agents.adapters.opencode import OpenCodeAdapter

_REGISTRY: dict[str, AgentAdapter] = {}


def register_adapter(agent_type: str, adapter: AgentAdapter) -> None:
    """Register an adapter for an agent type."""
    _REGISTRY[agent_type] = adapter


def get_adapter(agent_type: str) -> AgentAdapter:
    """Get the adapter for an agent type. Raises ValueError if unknown."""
    adapter = _REGISTRY.get(agent_type)
    if adapter is None:
        raise ValueError(f"No adapter registered for agent type: {agent_type!r}")
    return adapter


# Auto-register built-in adapters
register_adapter("claude-code", ClaudeCodeAdapter())
register_adapter("opencode", OpenCodeAdapter())
