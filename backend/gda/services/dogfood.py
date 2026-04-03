from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from asgiref.sync import async_to_sync

from agents.models import Agent, AgentFeedback
from gda.services.assignment import list_active_assignments_for_agent
from gda.services.mcp_surface import (
    admit_gda_observation_for_agent,
    get_gda_context_for_agent,
    propose_gda_commitment_for_agent,
    report_gda_execution_for_agent,
)
from gda.services.turn_brief import (
    build_agent_turn_brief_from_context,
    serialize_agent_turn_brief,
)


DOGFOOD_ALLOWED_ACTIONS = (
    "gda_observation_admit",
    "gda_commitment_propose",
    "gda_execution_report",
)
DOGFOOD_ROLES = frozenset({"lead", "worker"})


@dataclass(frozen=True, slots=True)
class DogfoodScope:
    capability_ids: tuple[str, ...] | None = None
    dimension_ids: tuple[str, ...] | None = None
    observation_kinds: tuple[str, ...] | None = None
    observation_subject_refs: tuple[str, ...] | None = None
    commitment_ids: tuple[str, ...] | None = None


@dataclass(frozen=True, slots=True)
class DogfoodTurn:
    role: str
    brief: dict[str, object]
    context_envelope: dict[str, object]
    allowed_actions: tuple[str, ...] = DOGFOOD_ALLOWED_ACTIONS


@dataclass(frozen=True, slots=True)
class DogfoodWriteResult:
    result: dict[str, object]
    next_turn: DogfoodTurn
    change_summary: dict[str, object]


def _normalize_strings(values: tuple[str, ...] | list[str] | None) -> tuple[str, ...]:
    return tuple(str(value) for value in (values or ()))


def _resolve_role(*, agent: Agent, role: str | None) -> str:
    candidate = role or getattr(agent, "role", "worker") or "worker"
    normalized = "lead" if candidate == "meta" else str(candidate)
    if normalized not in DOGFOOD_ROLES:
        raise ValueError(f"unsupported dogfood role: {candidate!r}")
    return normalized


def _copy_mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _scope_context(
    context: dict[str, object],
    *,
    scope: DogfoodScope,
) -> dict[str, object]:
    scoped = dict(context)
    state_entries = list(context.get("state_entries") or [])
    recent_observations = list(context.get("recent_observations") or [])
    active_commitments = list(context.get("active_commitments") or [])
    boundary = _copy_mapping(context.get("boundary"))

    if scope.dimension_ids is not None:
        allowed_dimension_ids = set(scope.dimension_ids)
        state_entries = [
            entry
            for entry in state_entries
            if str(entry.get("dimension_id")) in allowed_dimension_ids
        ]
    if scope.observation_subject_refs is not None:
        allowed_subject_refs = set(scope.observation_subject_refs)
        recent_observations = [
            observation
            for observation in recent_observations
            if str(observation.get("subject")) in allowed_subject_refs
        ]
    if scope.observation_kinds is not None:
        allowed_kinds = set(scope.observation_kinds)
        recent_observations = [
            observation
            for observation in recent_observations
            if str(observation.get("kind")) in allowed_kinds
        ]
    if scope.commitment_ids is not None:
        allowed_commitment_ids = set(scope.commitment_ids)
        active_commitments = [
            commitment
            for commitment in active_commitments
            if str(commitment.get("commitment_id")) in allowed_commitment_ids
        ]
    if scope.capability_ids is not None:
        allowed_capability_ids = set(scope.capability_ids)
        active_commitments = [
            commitment
            for commitment in active_commitments
            if str(commitment.get("capability_id")) in allowed_capability_ids
        ]
        if boundary:
            boundary["capability_ids"] = [
                capability_id
                for capability_id in boundary.get("capability_ids", [])
                if str(capability_id) in allowed_capability_ids
            ]

    awareness = _copy_mapping(context.get("awareness"))
    if awareness:
        awareness["state_entry_count"] = len(state_entries)
        awareness["recent_observation_count"] = len(recent_observations)
        awareness["active_commitment_count"] = len(active_commitments)

    scoped["state_entries"] = state_entries
    scoped["recent_observations"] = recent_observations
    scoped["active_commitments"] = active_commitments
    if boundary:
        scoped["boundary"] = boundary
    if awareness:
        scoped["awareness"] = awareness
    return scoped


def _unique_strings(values: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(values))


def _derive_worker_scope(*, agent: Agent) -> DogfoodScope:
    assignments = list_active_assignments_for_agent(agent=agent)
    capability_ids: list[str] = []
    dimension_ids: list[str] = []
    observation_kinds: list[str] = []
    observation_subject_refs: list[str] = []
    commitment_ids: list[str] = []

    for assignment in assignments:
        commitment = assignment.commitment
        capability_ids.append(str(commitment.capability_id))
        commitment_ids.append(str(commitment.commitment_id))
        dimension_ids.extend(str(item) for item in assignment.dimension_ids)
        observation_kinds.extend(str(item) for item in assignment.observation_kinds)
        observation_subject_refs.extend(str(item) for item in commitment.touched_scope)

    return DogfoodScope(
        capability_ids=_unique_strings(capability_ids),
        dimension_ids=_unique_strings(dimension_ids),
        observation_kinds=_unique_strings(observation_kinds),
        observation_subject_refs=_unique_strings(observation_subject_refs),
        commitment_ids=_unique_strings(commitment_ids),
    )


def _build_change_summary(
    *,
    result_kind: str,
    next_turn: DogfoodTurn,
    changed_observation_ids: tuple[str, ...] = (),
    changed_commitment_ids: tuple[str, ...] = (),
) -> dict[str, object]:
    return {
        "summary_type": "gda_dogfood_change_summary",
        "result_kind": result_kind,
        "changed_observation_ids": list(changed_observation_ids),
        "changed_commitment_ids": list(changed_commitment_ids),
        "control_status": next_turn.brief.get("control_status", ""),
        "progress_status": str(next_turn.brief.get("progress", {}).get("status") or ""),
        "recent_change_refs": [
            str(change.get("ref_id") or "")
            for change in next_turn.brief.get("recent_changes", [])
            if isinstance(change, dict)
        ],
    }


def _finish_dogfood_write(
    *,
    agent: Agent,
    role: str | None,
    scope: DogfoodScope | None,
    result: dict[str, object],
    result_kind: str,
    changed_observation_ids: tuple[str, ...] = (),
    changed_commitment_ids: tuple[str, ...] = (),
) -> DogfoodWriteResult:
    next_turn = build_gda_dogfood_turn(agent=agent, role=role, scope=scope)
    return DogfoodWriteResult(
        result=result,
        next_turn=next_turn,
        change_summary=_build_change_summary(
            result_kind=result_kind,
            next_turn=next_turn,
            changed_observation_ids=changed_observation_ids,
            changed_commitment_ids=changed_commitment_ids,
        ),
    )


def build_gda_dogfood_turn(
    *,
    agent: Agent,
    role: str | None = None,
    scope: DogfoodScope | None = None,
) -> DogfoodTurn:
    resolved_role = _resolve_role(agent=agent, role=role)
    context_envelope = async_to_sync(get_gda_context_for_agent)(agent)
    effective_scope = scope
    if resolved_role == "worker":
        effective_scope = scope or _derive_worker_scope(agent=agent)
        context_envelope = _scope_context(context_envelope, scope=effective_scope)
    brief = build_agent_turn_brief_from_context(
        context=context_envelope,
        role=resolved_role,
        allowed_actions=DOGFOOD_ALLOWED_ACTIONS,
    )
    return DogfoodTurn(
        role=resolved_role,
        brief=serialize_agent_turn_brief(brief),
        context_envelope=context_envelope,
    )


def dogfood_admit_observation(
    *,
    agent: Agent,
    observation_id: str,
    kind: str,
    payload: dict[str, object] | None = None,
    provenance_refs: list[str] | None = None,
    quality: str = "derived",
    subject: str = "",
    observed_at: str = "",
    valid_at: str = "",
    expires_at: str = "",
    role: str | None = None,
    scope: DogfoodScope | None = None,
) -> DogfoodWriteResult:
    result = async_to_sync(admit_gda_observation_for_agent)(
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
    return _finish_dogfood_write(
        agent=agent,
        role=role,
        scope=scope,
        result=result,
        result_kind="observation_admitted",
        changed_observation_ids=(str(result.get("observation", {}).get("observation_id", "")),),
    )


def dogfood_propose_commitment(
    *,
    agent: Agent,
    capability_id: str,
    arguments: dict[str, object] | None = None,
    touched_scope: list[str] | None = None,
    expected_observation: dict[str, object] | None = None,
    expected_outcome: dict[str, object] | None = None,
    commitment_id: str = "",
    role: str | None = None,
    scope: DogfoodScope | None = None,
) -> DogfoodWriteResult:
    result = async_to_sync(propose_gda_commitment_for_agent)(
        agent,
        capability_id=capability_id,
        arguments=arguments,
        touched_scope=touched_scope,
        expected_observation=expected_observation,
        expected_outcome=expected_outcome,
        commitment_id=commitment_id,
    )
    return _finish_dogfood_write(
        agent=agent,
        role=role,
        scope=scope,
        result=result,
        result_kind="commitment_proposed",
        changed_commitment_ids=(str(result.get("commitment", {}).get("commitment_id", "")),),
    )


def dogfood_report_execution(
    *,
    agent: Agent,
    invocation_id: str,
    status: str,
    commitment_id: str = "",
    resource_usage: dict[str, float] | None = None,
    artifact_refs: list[str] | None = None,
    metadata: dict[str, object] | None = None,
    observations: list[dict[str, Any]] | None = None,
    completed_at: str = "",
    role: str | None = None,
    scope: DogfoodScope | None = None,
) -> DogfoodWriteResult:
    result = async_to_sync(report_gda_execution_for_agent)(
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
    changed_observation_ids = tuple(
        str(item.get("observation_id") or "")
        for item in result.get("observations", [])
        if isinstance(item, dict)
    )
    changed_commitment_id = str(result.get("commitment", {}).get("commitment_id") or "")
    changed_commitment_ids = (changed_commitment_id,) if changed_commitment_id else ()
    return _finish_dogfood_write(
        agent=agent,
        role=role,
        scope=scope,
        result=result,
        result_kind="execution_reported",
        changed_observation_ids=changed_observation_ids,
        changed_commitment_ids=changed_commitment_ids,
    )


def record_gda_dogfood_feedback(
    *,
    agent: Agent,
    rating: int,
    comment: str = "",
) -> AgentFeedback:
    return AgentFeedback.objects.create(
        agent=agent,
        session_id=agent.session_id,
        rating=rating,
        comment=comment,
    )
