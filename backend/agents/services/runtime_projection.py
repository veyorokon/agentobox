from __future__ import annotations

from typing import Any


READY_STARTUP_STAGES = {"runtime_ready", "managed_ready"}


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


def runtime_status_meets_ready_boundary(
    status: dict[str, Any],
    *,
    relay_connected: bool = False,
) -> bool:
    """Return True when runtime truth has crossed the minimum usable boundary.

    Desktop-managed runtimes are only ready once transport is connected and the
    runtime reports ``managed_ready``. Non-desktop runtimes can satisfy the
    boundary at ``runtime_ready``.
    """

    if not status:
        return False

    stage = str(status.get("startup_stage", "") or "")
    profile = str(status.get("profile", "") or "")

    if profile == "desktop":
        return relay_connected and stage == "managed_ready"
    return stage in READY_STARTUP_STAGES


def agent_meets_ready_boundary(agent) -> bool:
    """Evaluate the runtime-owned readiness boundary for an agent."""

    return runtime_status_meets_ready_boundary(
        read_runtime_status(agent),
        relay_connected=bool(getattr(agent, "relay_connected", False)),
    )
