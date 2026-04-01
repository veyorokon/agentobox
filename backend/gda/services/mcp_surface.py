from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from asgiref.sync import sync_to_async
from fastmcp.exceptions import ToolError

from gda.services.admission import admit_project_observation
from gda.services.commitments import persist_commitment_proposal
from gda.services.control_step import build_control_context
from gda.services.runtime_completion import process_runtime_completion
from gda_kernel import CommitmentProposal, ExecutionOutcome, Observation, ObservationSource
from projects.models import Project


def _parse_datetime(value: str | None, *, field_name: str) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ToolError(f"{field_name} must be an ISO-8601 datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


async def _get_project_for_agent(agent) -> Project:
    try:
        return await Project.objects.aget(id=agent.project_id)
    except Project.DoesNotExist as exc:
        raise ToolError("Authenticated agent has no project") from exc


async def get_gda_context_for_agent(agent) -> dict[str, object]:
    project = await _get_project_for_agent(agent)
    try:
        context = await sync_to_async(build_control_context, thread_sensitive=True)(
            project=project,
        )
    except Project.DoesNotExist as exc:
        raise ToolError("Project has no canonical GDA state yet") from exc
    return {
        **context,
        "recent_observations": list(context["recent_observations"]),
        "active_commitments": list(context["active_commitments"]),
    }


async def list_gda_recent_observations_for_agent(agent) -> list[dict[str, object]]:
    context = await get_gda_context_for_agent(agent)
    return list(context["recent_observations"])


async def list_gda_active_commitments_for_agent(agent) -> list[dict[str, object]]:
    context = await get_gda_context_for_agent(agent)
    return list(context["active_commitments"])


async def admit_gda_observation_for_agent(
    agent,
    *,
    observation_id: str,
    kind: str,
    payload: dict[str, object] | None = None,
    provenance_refs: list[str] | None = None,
    quality: str = "derived",
    subject: str = "",
    observed_at: str = "",
    valid_at: str = "",
    expires_at: str = "",
) -> dict[str, object]:
    project = await _get_project_for_agent(agent)
    observed_dt = _parse_datetime(observed_at, field_name="observed_at") or datetime.now(timezone.utc)
    valid_dt = _parse_datetime(valid_at, field_name="valid_at")
    expires_dt = _parse_datetime(expires_at, field_name="expires_at")
    record = await sync_to_async(admit_project_observation, thread_sensitive=True)(
        project=project,
        candidate=Observation(
            observation_id=observation_id,
            kind=kind,
            subject=subject or f"project://{project.id}",
            observed_at=observed_dt,
            valid_at=valid_dt,
            expires_at=expires_dt,
            source=ObservationSource(kind="agent", source_id=agent.name),
            payload=dict(payload or {}),
            provenance_refs=tuple(provenance_refs or ()),
            quality=quality,
        ),
    )
    return {
        "ok": True,
        "observation": {
            "observation_id": record.observation_id,
            "kind": record.kind,
            "subject": record.subject,
            "source_kind": record.source_kind,
            "source_id": record.source_id,
            "quality": record.quality,
        },
    }


def _build_agent_observation(
    *,
    agent,
    project: Project,
    observation: dict[str, Any],
) -> Observation:
    observed_dt = _parse_datetime(str(observation.get("observed_at") or ""), field_name="observed_at") or datetime.now(timezone.utc)
    valid_dt = _parse_datetime(str(observation.get("valid_at") or ""), field_name="valid_at")
    expires_dt = _parse_datetime(str(observation.get("expires_at") or ""), field_name="expires_at")
    payload = dict(observation.get("payload") or {})
    reported_source_kind = observation.get("source_kind")
    reported_source_id = observation.get("source_id")
    if reported_source_kind or reported_source_id:
        payload["reported_source"] = {
            "kind": str(reported_source_kind or "agent"),
            "source_id": str(reported_source_id or agent.name),
        }
    return Observation(
        observation_id=str(observation["observation_id"]),
        kind=str(observation["kind"]),
        subject=str(observation.get("subject") or f"project://{project.id}"),
        observed_at=observed_dt,
        valid_at=valid_dt,
        expires_at=expires_dt,
        source=ObservationSource(kind="agent", source_id=agent.name),
        payload=payload,
        provenance_refs=tuple(str(item) for item in observation.get("provenance_refs") or ()),
        quality=str(observation.get("quality") or "derived"),
    )


async def propose_gda_commitment_for_agent(
    agent,
    *,
    capability_id: str,
    arguments: dict[str, object] | None = None,
    touched_scope: list[str] | None = None,
    expected_observation: dict[str, object] | None = None,
    expected_outcome: dict[str, object] | None = None,
    commitment_id: str = "",
) -> dict[str, object]:
    project = await _get_project_for_agent(agent)
    record = await sync_to_async(persist_commitment_proposal, thread_sensitive=True)(
        project=project,
        proposal=CommitmentProposal(
            capability_id=capability_id,
            arguments=dict(arguments or {}),
            touched_scope=tuple(touched_scope or (f"project://{project.id}",)),
            expected_observation=dict(expected_observation or {}),
            expected_outcome=dict(expected_outcome or {}),
        ),
        commitment_id=commitment_id or uuid.uuid4().hex[:16],
        status="proposed",
    )
    return {
        "ok": True,
        "commitment": {
            "commitment_id": record.commitment_id,
            "capability_id": record.capability_id,
            "status": record.status,
            "objective_id": record.objective_id,
        },
    }


async def report_gda_execution_for_agent(
    agent,
    *,
    invocation_id: str,
    status: str,
    commitment_id: str = "",
    resource_usage: dict[str, float] | None = None,
    artifact_refs: list[str] | None = None,
    metadata: dict[str, object] | None = None,
    observations: list[dict[str, Any]] | None = None,
    completed_at: str = "",
) -> dict[str, object]:
    project = await _get_project_for_agent(agent)
    completed_dt = _parse_datetime(completed_at, field_name="completed_at")
    result = await sync_to_async(process_runtime_completion, thread_sensitive=True)(
        project=project,
        outcome=ExecutionOutcome(
            invocation_id=invocation_id,
            commitment_id=commitment_id or None,
            status=status,
            resource_usage=dict(resource_usage or {}),
            artifact_refs=tuple(str(item) for item in artifact_refs or ()),
            metadata=dict(metadata or {}),
        ),
        observations=tuple(
            _build_agent_observation(agent=agent, project=project, observation=item)
            for item in (observations or [])
        ),
        completed_at=completed_dt,
    )
    return {
        "ok": True,
        "execution": {
            "invocation_id": result.execution.invocation_id,
            "status": result.execution.status,
            "commitment_id": commitment_id or None,
        },
        "observations": [
            {
                "observation_id": record.observation_id,
                "kind": record.kind,
            }
            for record in result.observations
        ],
        "commitment": (
            {
                "commitment_id": result.commitment.commitment_id,
                "status": result.commitment.status,
                "close_reason": result.commitment.close_reason,
            }
            if result.commitment is not None
            else None
        ),
    }


def register_gda_tools(*, mcp, authenticate) -> None:
    @mcp.resource(
        "gda://project/context",
        name="gda_project_context",
        mime_type="application/json",
    )
    async def gda_project_context_resource() -> dict[str, object]:
        """Read the canonical GDA control context for your project."""
        agent = await authenticate()
        return await get_gda_context_for_agent(agent)

    @mcp.resource(
        "gda://project/observations/recent",
        name="gda_recent_observations",
        mime_type="application/json",
    )
    async def gda_recent_observations_resource() -> list[dict[str, object]]:
        """Read recent admitted observations for your project."""
        agent = await authenticate()
        return await list_gda_recent_observations_for_agent(agent)

    @mcp.resource(
        "gda://project/commitments/active",
        name="gda_active_commitments",
        mime_type="application/json",
    )
    async def gda_active_commitments_resource() -> list[dict[str, object]]:
        """Read active commitments for your project."""
        agent = await authenticate()
        return await list_gda_active_commitments_for_agent(agent)

    @mcp.tool
    async def gda_context_get() -> dict[str, object]:
        """Get the canonical GDA control context for your project."""
        agent = await authenticate()
        return await get_gda_context_for_agent(agent)

    @mcp.tool
    async def gda_observation_admit(
        observation_id: str,
        kind: str,
        payload: dict[str, Any] | None = None,
        provenance_refs: list[str] | None = None,
        quality: str = "derived",
        subject: str = "",
        observed_at: str = "",
        valid_at: str = "",
        expires_at: str = "",
    ) -> dict[str, object]:
        """Admit an agent-sourced observation into canonical project state."""
        agent = await authenticate()
        return await admit_gda_observation_for_agent(
            agent,
            observation_id=observation_id,
            kind=kind,
            payload=payload,
            provenance_refs=provenance_refs,
            quality=quality,
            subject=subject,
            observed_at=observed_at,
            valid_at=valid_at,
            expires_at=expires_at,
        )

    @mcp.tool
    async def gda_commitment_propose(
        capability_id: str,
        arguments: dict[str, Any] | None = None,
        touched_scope: list[str] | None = None,
        expected_observation: dict[str, Any] | None = None,
        expected_outcome: dict[str, Any] | None = None,
        commitment_id: str = "",
    ) -> dict[str, object]:
        """Propose a new commitment for the authenticated agent's project."""
        agent = await authenticate()
        return await propose_gda_commitment_for_agent(
            agent,
            capability_id=capability_id,
            arguments=arguments,
            touched_scope=touched_scope,
            expected_observation=expected_observation,
            expected_outcome=expected_outcome,
            commitment_id=commitment_id,
        )

    @mcp.tool
    async def gda_execution_report(
        invocation_id: str,
        status: str,
        commitment_id: str = "",
        resource_usage: dict[str, float] | None = None,
        artifact_refs: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        observations: list[dict[str, Any]] | None = None,
        completed_at: str = "",
    ) -> dict[str, object]:
        """Report an execution outcome and any derived observations."""
        agent = await authenticate()
        return await report_gda_execution_for_agent(
            agent,
            invocation_id=invocation_id,
            status=status,
            commitment_id=commitment_id,
            resource_usage=resource_usage,
            artifact_refs=artifact_refs,
            metadata=metadata,
            observations=observations,
            completed_at=completed_at,
        )
