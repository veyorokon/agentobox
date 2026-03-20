from __future__ import annotations

from typing import Any


def read_runtime_status(agent) -> dict[str, Any]:
    """Return the canonical backend-visible runtime status view for an agent.

    Preferred source is the control-plane projection pushed by the runtime over
    relay. Local/shared-volume reads remain a compatibility fallback for Docker
    and for agents that have not yet published a projection.
    """

    projected = getattr(agent, "runtime_status_projection", None)
    if isinstance(projected, dict) and projected:
        return projected
    try:
        return agent.volume.runtime_status()
    except (OSError, TypeError, ValueError):  # intentional: preview/reconcile must degrade safely if runtime status is unreadable
        return {}
