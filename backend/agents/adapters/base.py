"""AgentAdapter Protocol — the port in Ports and Adapters.

Adapters translate agent-specific event formats into our vocabulary.
Each method extracts one display field from a snapshot dict.

First principles:
    - Raw events are the only source of truth
    - Adapters are pure functions over JSON — no DB access, no side effects
    - Agent-specific vocabulary (e.g. total_cost_usd, permissionMode) exists
      ONLY inside adapter method bodies
    - Everything after the adapter uses our vocabulary (cost, turns, duration)

Snapshot structure (written by stream.py):
    {
        "assistant": { <full assistant event dict> },
        "result": { <full result event dict> }
    }

Adapters may NOT:
    - Import from agents.models or agents.services
    - Perform database queries
    - Mutate the snapshot dict
    - Raise exceptions (return defaults for missing/malformed data)
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class AgentAdapter(Protocol):
    """Port: extract display fields from an agent's latest_snapshot."""

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
