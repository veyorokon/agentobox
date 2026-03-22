from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from django.utils import timezone

from agents.models import Agent, AgentStatus, DesiredStatus
from agents.services.runtime_projection import agent_meets_ready_boundary, read_runtime_status


ACTIVE_STATUSES = (
    AgentStatus.DEPLOYING,
    AgentStatus.IDLE,
    AgentStatus.RUNNING,
    AgentStatus.WAITING,
)


@dataclass(frozen=True)
class NonConvergedActiveAgentCandidate:
    agent_id: str
    project_id: str
    agent_name: str
    signature: str
    reason: str
    age_seconds: int
    lifecycle_status: str
    desired_status: str
    relay_connected: bool
    preview_state: str | None
    preview_runtime_id: str
    is_converged: bool
    runtime_startup_stage: str | None
    runtime_profile: str | None

    def asdict(self) -> dict[str, object]:
        return asdict(self)


def _derive_preview_state_safe(agent) -> str | None:
    from agents.serializers import derive_preview_state

    try:
        return derive_preview_state(agent)
    except Exception as exc:  # intentional: best-effort — preview state is supplementary for non-converged classification
        import structlog
        structlog.get_logger("abox.lifecycle").debug(
            "lifecycle.preview_state_failed",
            error_code="ERR-LIMBO-PREVIEW-DERIVE",
            error_class=type(exc).__name__,
        )
        return None


def classify_non_converged_active_agent(
    agent,
    *,
    now: datetime | None = None,
    grace_seconds: int = 120,
) -> NonConvergedActiveAgentCandidate | None:
    """Return a concrete non-converged signature when an active agent is half-alive but not converged."""

    now = now or timezone.now()
    updated_at = getattr(agent, "updated_at", None)
    age_seconds = int((now - updated_at).total_seconds()) if updated_at else 0

    if age_seconds < grace_seconds:
        return None
    if getattr(agent, "desired_status", "") != DesiredStatus.DEPLOYED:
        return None
    if getattr(agent, "status", "") not in ACTIVE_STATUSES:
        return None

    relay_connected = bool(getattr(agent, "relay_connected", False))
    preview_state = _derive_preview_state_safe(agent)
    preview_runtime_id = str(getattr(agent, "sandbox_id", "") or "")
    runtime_status = read_runtime_status(agent)
    is_converged = bool(getattr(agent, "is_converged", False))

    signature = None
    reason = None

    if relay_connected and not agent_meets_ready_boundary(agent):
        signature = "relay_connected_not_ready"
        reason = "Relay connected but runtime never crossed the ready boundary"
    elif preview_state == "ready" and not relay_connected and not is_converged:
        signature = "preview_ready_relay_disconnected"
        reason = "Preview projects ready while relay is disconnected and the agent is not converged"

    if not signature or not reason:
        return None

    return NonConvergedActiveAgentCandidate(
        agent_id=str(agent.id),
        project_id=str(agent.project_id),
        agent_name=str(getattr(agent, "name", "")),
        signature=signature,
        reason=reason,
        age_seconds=age_seconds,
        lifecycle_status=str(getattr(agent, "status", "")),
        desired_status=str(getattr(agent, "desired_status", "")),
        relay_connected=relay_connected,
        preview_state=preview_state,
        preview_runtime_id=preview_runtime_id,
        is_converged=is_converged,
        runtime_startup_stage=runtime_status.get("startup_stage"),
        runtime_profile=runtime_status.get("profile"),
    )


def list_non_converged_active_agent_candidates(
    *,
    now: datetime | None = None,
    grace_seconds: int = 120,
) -> list[NonConvergedActiveAgentCandidate]:
    """Return all currently visible active agents matching a known non-converged signature."""

    now = now or timezone.now()
    agents = Agent.objects.filter(
        desired_status=DesiredStatus.DEPLOYED,
        status__in=ACTIVE_STATUSES,
    ).select_related("project")

    matches: list[NonConvergedActiveAgentCandidate] = []
    for agent in agents:
        candidate = classify_non_converged_active_agent(
            agent,
            now=now,
            grace_seconds=grace_seconds,
        )
        if candidate is not None:
            matches.append(candidate)
    return matches
