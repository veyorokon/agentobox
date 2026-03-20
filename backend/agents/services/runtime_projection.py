from __future__ import annotations

from typing import Any


def read_runtime_status(agent) -> dict[str, Any]:
    """Return the canonical backend-visible runtime status view for an agent.

    Runtime status is agent-owned machine truth mirrored into the control plane
    as a projection. Backend reads consume that projection and degrade safely
    when it has not been published yet.
    """

    projected = getattr(agent, "runtime_status_projection", None)
    if isinstance(projected, dict) and projected:
        return projected
    return {}
