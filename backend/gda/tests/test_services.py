from __future__ import annotations

from datetime import datetime, timezone

import pytest
from django.contrib.auth import get_user_model

from gda.models import ProjectCommitment, ProjectExecution, ProjectObservation, ProjectState, ProjectStateEntry
from gda.services.admission import (
    admit_project_observation,
    admit_project_observations,
    project_observation_to_contract,
)
from gda.services.commitments import (
    CommitmentAuthorizationError,
    CommitmentConflictError,
    authorize_commitment,
    persist_commitment_proposal,
    project_commitment_to_contract,
    update_commitment_status,
)
from gda.services.compile import compile_run_spec_for_project
from gda.services.control_step import build_control_context, run_control_step
from gda.services.execution import (
    ExecutionConflictError,
    project_execution_to_contract,
    record_execution_outcome,
)
from gda.services.runtime_completion import process_runtime_completion
from gda.services.reduction import apply_project_state_delta, list_project_state_entries, project_state_entry_to_contract
from gda.services.state import persist_run_spec_state, project_state_to_contract
from gda_kernel import (
    CommitmentProposal,
    DimensionDefinition,
    DimensionRegistry,
    ExecutionOutcome,
    Observation,
    ObservationAdmissionError,
    ObservationSource,
    State,
    StateDelta,
    StateEntry,
    StateVersion,
    project_ref,
    run_ref,
    world_ref,
)
from projects.models import Project


pytestmark = pytest.mark.integration


@pytest.mark.django_db
def test_compile_run_spec_for_project_compiles_project_into_kernel_run_spec():
    user = get_user_model().objects.create_user(username="gda-compile", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)

    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "assess supplier impact",
                    "desired_state": {"supplier_risk_assessed": True},
                },
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
            "budget": {"steps": 3},
        },
        now=datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc),
        world_ref=world_ref(project.id),
    )

    assert run_spec.run_id == run_ref(project.id)
    assert run_spec.objective.name == "Handle supplier delay"
    assert run_spec.metadata["project_ref"] == project_ref(project.id)
    assert run_spec.metadata["project_name"] == "OpenVending Ops"


@pytest.mark.django_db
def test_persist_run_spec_state_writes_canonical_project_state():
    user = get_user_model().objects.create_user(username="gda-state", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "assess supplier impact",
                    "desired_state": {"supplier_risk_assessed": True},
                },
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
            "budget": {"steps": 3},
        },
        now=now,
        world_ref=world_ref(project.id),
    )

    record = persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=project_ref(project.id),
            version=StateVersion(version_id="v3", observed_at=now, source_refs=("seed:1",)),
            facts={"supplier_risk_assessed": False},
        ),
        status="running",
    )

    assert record.run_id == run_ref(project.id)
    assert record.status == "running"
    assert record.objective["name"] == "Handle supplier delay"
    assert record.boundary["capability_ids"] == ["ops.measure_supplier_risk"]
    assert project_state_to_contract(record).facts["supplier_risk_assessed"] is False


@pytest.mark.django_db
def test_apply_project_state_delta_persists_general_state_entries_and_updates_version():
    user = get_user_model().objects.create_user(username="gda-reduce", password="test")
    project = Project.objects.create(name="Agentobox Project", owner=user)
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Run project",
            "goals": (
                {"goal_id": "goal-1", "name": "maintain state", "desired_state": {"ok": True}},
            ),
            "allowed_capabilities": ("ops.measure",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="runtime.health",
                schema_ref="status.readiness.v1",
                owner_ref="world://ops",
            ),
            DimensionDefinition(
                dimension_id="release.current_candidate",
                schema_ref="ref.manifest.v1",
                owner_ref="world://delivery",
            ),
        )
    )

    records = apply_project_state_delta(
        project=project,
        delta=StateDelta(
            upserts=(
                StateEntry(
                    dimension_id="runtime.health",
                    value={"status": "ready"},
                    schema_ref="status.readiness.v1",
                    origin="observed",
                    valid_from=now,
                    provenance_refs=("obs:runtime-1",),
                ),
                StateEntry(
                    dimension_id="release.current_candidate",
                    value={"manifest_ref": "manifest:17"},
                    schema_ref="ref.manifest.v1",
                    origin="declared",
                    valid_from=now,
                    provenance_refs=("obs:release-1",),
                ),
            )
        ),
        registry=registry,
        version=StateVersion(version_id="v2", observed_at=now, source_refs=("seed:2",)),
    )

    assert len(records) == 2
    assert ProjectStateEntry.objects.filter(project=project).count() == 2
    state = ProjectState.objects.get(project=project)
    assert state.state_version_id == "v2"
    assert state.source_refs == ["seed:2"]
    entries = list_project_state_entries(project=project)
    assert tuple(entry.dimension_id for entry in entries) == (
        "release.current_candidate",
        "runtime.health",
    )


@pytest.mark.django_db
def test_apply_project_state_delta_is_idempotent_for_same_delta():
    user = get_user_model().objects.create_user(username="gda-reduce-idempotent", password="test")
    project = Project.objects.create(name="Agentobox Project", owner=user)
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Run project",
            "goals": (
                {"goal_id": "goal-1", "name": "maintain state", "desired_state": {"ok": True}},
            ),
            "allowed_capabilities": ("ops.measure",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="game.loop.playable",
                schema_ref="status.playable_build.v1",
                owner_ref="world://game",
            ),
        )
    )
    delta = StateDelta(
        upserts=(
            StateEntry(
                dimension_id="game.loop.playable",
                value={"playable": True, "build_ref": "artifact:build-17"},
                schema_ref="status.playable_build.v1",
                origin="observed",
                valid_from=now,
                provenance_refs=("obs:build-17",),
            ),
        )
    )

    first = apply_project_state_delta(
        project=project,
        delta=delta,
        registry=registry,
        version=StateVersion(version_id="v2", observed_at=now),
    )
    second = apply_project_state_delta(
        project=project,
        delta=delta,
        registry=registry,
        version=StateVersion(version_id="v2", observed_at=now),
    )

    assert ProjectStateEntry.objects.filter(project=project).count() == 1
    assert second[0].id == first[0].id


@pytest.mark.django_db
def test_apply_project_state_delta_removes_dimensions_from_canonical_reduced_state():
    user = get_user_model().objects.create_user(username="gda-reduce-remove", password="test")
    project = Project.objects.create(name="Agentobox Project", owner=user)
    now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Run project",
            "goals": (
                {"goal_id": "goal-1", "name": "maintain state", "desired_state": {"ok": True}},
            ),
            "allowed_capabilities": ("ops.measure",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    registry = DimensionRegistry(
        (
            DimensionDefinition(
                dimension_id="runtime.health",
                schema_ref="status.readiness.v1",
                owner_ref="world://ops",
            ),
        )
    )
    apply_project_state_delta(
        project=project,
        delta=StateDelta(
            upserts=(
                StateEntry(
                    dimension_id="runtime.health",
                    value={"status": "ready"},
                    schema_ref="status.readiness.v1",
                    origin="observed",
                    valid_from=now,
                ),
            )
        ),
        registry=registry,
        version=StateVersion(version_id="v2", observed_at=now),
    )

    records = apply_project_state_delta(
        project=project,
        delta=StateDelta(removes=("runtime.health",)),
        registry=registry,
        version=StateVersion(version_id="v3", observed_at=now),
    )

    assert records == ()
    assert ProjectStateEntry.objects.filter(project=project).count() == 0


@pytest.mark.django_db
def test_admit_project_observation_persists_canonical_record():
    user = get_user_model().objects.create_user(username="gda-admit", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    observed_at = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)

    record = admit_project_observation(
        project=project,
        candidate=Observation(
            observation_id="obs-email-1",
            subject=f"project://{project.id}",
            kind="communication.email.received",
            observed_at=observed_at,
            valid_at=observed_at,
            source=ObservationSource(kind="gmail", source_id="inbox"),
            payload={"subject": "Delay on chips order"},
            provenance_refs=("gmail:msg-1",),
        ),
        known_source_kinds=("gmail",),
        freshness_policy={"require_provenance": True},
    )

    assert ProjectObservation.objects.filter(project=project).count() == 1
    assert record.kind == "communication.email.received"
    assert project_observation_to_contract(record).source.kind == "gmail"


@pytest.mark.django_db
def test_admit_project_observations_keeps_conflicting_evidence_with_distinct_ids():
    user = get_user_model().objects.create_user(username="gda-conflict", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    observed_at = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)

    records = admit_project_observations(
        project=project,
        candidates=(
            Observation(
                observation_id="obs-build",
                subject=f"project://{project.id}",
                kind="runtime.build_succeeded",
                observed_at=observed_at,
                valid_at=observed_at,
                source=ObservationSource(kind="subagent", source_id="builder"),
                payload={"claim": "build succeeded"},
                provenance_refs=("artifact:build-log",),
                quality="derived",
            ),
            Observation(
                observation_id="obs-health",
                subject=f"project://{project.id}",
                kind="runtime.healthcheck_failed",
                observed_at=observed_at,
                valid_at=observed_at,
                source=ObservationSource(kind="monitor", source_id="deploy-health"),
                payload={"claim": "healthcheck failed"},
                provenance_refs=("monitor:healthcheck-1",),
                quality="exact",
            ),
        ),
    )

    assert len(records) == 2
    assert {record.source_kind for record in records} == {"subagent", "monitor"}


@pytest.mark.django_db
def test_admit_project_observation_returns_existing_record_for_idempotent_retry():
    user = get_user_model().objects.create_user(username="gda-duplicate", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    observed_at = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)

    first = admit_project_observation(
        project=project,
        candidate=Observation(
            observation_id="obs-1",
            subject=f"project://{project.id}",
            kind="user.steering",
            observed_at=observed_at,
            valid_at=observed_at,
            source=ObservationSource(kind="user", source_id="chat"),
            payload={"message": "Assess supplier risk."},
            provenance_refs=("chat:1",),
        ),
    )

    second = admit_project_observation(
        project=project,
        candidate=Observation(
            observation_id="obs-1",
            subject=f"project://{project.id}",
            kind="user.steering",
            observed_at=observed_at,
            valid_at=observed_at,
            source=ObservationSource(kind="user", source_id="chat"),
            payload={"message": "Assess supplier risk."},
            provenance_refs=("chat:1",),
        ),
    )

    assert ProjectObservation.objects.filter(project=project).count() == 1
    assert second.id == first.id


@pytest.mark.django_db
def test_admit_project_observation_rejects_conflicting_reuse_of_observation_id():
    user = get_user_model().objects.create_user(username="gda-duplicate-conflict", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    observed_at = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)

    admit_project_observation(
        project=project,
        candidate=Observation(
            observation_id="obs-1",
            subject=f"project://{project.id}",
            kind="user.steering",
            observed_at=observed_at,
            valid_at=observed_at,
            source=ObservationSource(kind="user", source_id="chat"),
            payload={"message": "Assess supplier risk."},
            provenance_refs=("chat:1",),
        ),
    )

    with pytest.raises(ObservationAdmissionError, match="observation id conflict"):
        admit_project_observation(
            project=project,
            candidate=Observation(
                observation_id="obs-1",
                subject=f"project://{project.id}",
                kind="user.steering",
                observed_at=observed_at,
                valid_at=observed_at,
                source=ObservationSource(kind="user", source_id="chat"),
                payload={"message": "Assess supplier risk again."},
                provenance_refs=("chat:1",),
            ),
        )


@pytest.mark.django_db
def test_record_execution_outcome_persists_and_links_commitment():
    user = get_user_model().objects.create_user(username="gda-exec", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    commitment = ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )

    record = record_execution_outcome(
        project=project,
        outcome=ExecutionOutcome(
            invocation_id="invoke-1",
            commitment_id="commitment-1",
            status="ok",
            resource_usage={"tokens": 42.0},
            artifact_refs=("artifact:risk-report",),
            metadata={"executor": "meta-agent"},
        ),
        completed_at=datetime(2026, 3, 31, 12, 5, tzinfo=timezone.utc),
    )

    assert ProjectExecution.objects.filter(project=project).count() == 1
    assert record.commitment_id == commitment.id
    outcome = project_execution_to_contract(record)
    assert outcome.commitment_id == "commitment-1"
    assert outcome.resource_usage["tokens"] == 42.0


@pytest.mark.django_db
def test_record_execution_outcome_returns_existing_record_for_idempotent_retry():
    user = get_user_model().objects.create_user(username="gda-exec-idempotent", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    completed_at = datetime(2026, 3, 31, 12, 5, tzinfo=timezone.utc)
    outcome = ExecutionOutcome(
        invocation_id="invoke-1",
        status="ok",
        resource_usage={"tokens": 42.0},
        artifact_refs=("artifact:risk-report",),
        metadata={"executor": "meta-agent"},
    )

    first = record_execution_outcome(project=project, outcome=outcome, completed_at=completed_at)
    second = record_execution_outcome(project=project, outcome=outcome, completed_at=completed_at)

    assert ProjectExecution.objects.filter(project=project).count() == 1
    assert second.id == first.id


@pytest.mark.django_db
def test_record_execution_outcome_rejects_conflicting_reuse_of_invocation_id():
    user = get_user_model().objects.create_user(username="gda-exec-conflict", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    completed_at = datetime(2026, 3, 31, 12, 5, tzinfo=timezone.utc)

    record_execution_outcome(
        project=project,
        outcome=ExecutionOutcome(invocation_id="invoke-1", status="ok"),
        completed_at=completed_at,
    )

    with pytest.raises(ExecutionConflictError, match="execution invocation conflict"):
        record_execution_outcome(
            project=project,
            outcome=ExecutionOutcome(invocation_id="invoke-1", status="error"),
            completed_at=completed_at,
        )


@pytest.mark.django_db
def test_persist_commitment_proposal_writes_canonical_commitment():
    user = get_user_model().objects.create_user(username="gda-commit", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "assess supplier impact",
                    "desired_state": {"supplier_risk_assessed": True},
                },
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")

    record = persist_commitment_proposal(
        project=project,
        proposal=CommitmentProposal(
            capability_id="ops.measure_supplier_risk",
            arguments={"metric": "supplier_risk"},
            touched_scope=(f"project://{project.id}",),
            expected_observation={"kind": "measurement.sampled", "required": True},
            expected_outcome={"status": "ok", "required": True},
        ),
        commitment_id="commitment-1",
        status="active",
        opened_at=now,
    )

    assert record.capability_id == "ops.measure_supplier_risk"
    commitment = project_commitment_to_contract(record)
    assert commitment.status == "active"
    assert commitment.expected_observation["kind"] == "measurement.sampled"


@pytest.mark.django_db
def test_persist_commitment_proposal_returns_existing_record_for_idempotent_retry():
    user = get_user_model().objects.create_user(username="gda-commit-idempotent", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {"goal_id": "goal-1", "name": "assess supplier impact", "desired_state": {"supplier_risk_assessed": True}},
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    proposal = CommitmentProposal(
        capability_id="ops.measure_supplier_risk",
        arguments={"metric": "supplier_risk"},
    )

    first = persist_commitment_proposal(project=project, proposal=proposal, commitment_id="commitment-1")
    second = persist_commitment_proposal(project=project, proposal=proposal, commitment_id="commitment-1")

    assert ProjectCommitment.objects.filter(project=project).count() == 1
    assert second.id == first.id


@pytest.mark.django_db
def test_persist_commitment_proposal_rejects_conflicting_reuse_of_commitment_id():
    user = get_user_model().objects.create_user(username="gda-commit-conflict", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {"goal_id": "goal-1", "name": "assess supplier impact", "desired_state": {"supplier_risk_assessed": True}},
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    persist_commitment_proposal(
        project=project,
        proposal=CommitmentProposal(capability_id="ops.measure_supplier_risk"),
        commitment_id="commitment-1",
    )

    with pytest.raises(CommitmentConflictError, match="commitment id conflict"):
        persist_commitment_proposal(
            project=project,
            proposal=CommitmentProposal(capability_id="ops.reply_supplier"),
            commitment_id="commitment-1",
        )


@pytest.mark.django_db
def test_authorize_commitment_rejects_capability_outside_project_boundary():
    user = get_user_model().objects.create_user(username="gda-authorize", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "assess supplier impact",
                    "desired_state": {"supplier_risk_assessed": True},
                },
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")
    persist_commitment_proposal(
        project=project,
        proposal=CommitmentProposal(
            capability_id="ops.reply_supplier",
            arguments={"template": "delay-followup"},
        ),
        commitment_id="commitment-unauthorized",
        status="proposed",
        opened_at=now,
    )

    with pytest.raises(CommitmentAuthorizationError, match="not authorized"):
        authorize_commitment(
            project=project,
            commitment_id="commitment-unauthorized",
            activated_at=now,
        )


@pytest.mark.django_db
def test_run_control_step_builds_context_from_canonical_state_and_records_commitment():
    user = get_user_model().objects.create_user(username="gda-loop", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "assess supplier impact",
                    "desired_state": {"supplier_risk_assessed": True},
                },
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(
        project=project,
        run_spec=run_spec,
        state=State(
            subject=f"project://{project.id}",
            version=StateVersion(version_id="v2", observed_at=now, source_refs=("seed:1",)),
            facts={"supplier_delay_detected": True},
        ),
        status="running",
    )
    admit_project_observation(
        project=project,
        candidate=Observation(
            observation_id="obs-email-1",
            subject=f"project://{project.id}",
            kind="communication.email.received",
            observed_at=now,
            valid_at=now,
            source=ObservationSource(kind="gmail", source_id="inbox"),
            payload={"subject": "Delay on chips order"},
            provenance_refs=("gmail:msg-1",),
        ),
    )

    context = build_control_context(project=project)
    assert context.context_version_id == "v2"
    assert context.subject_ref == f"project://{project.id}"
    assert len(context.recent_observations) == 1

    created = run_control_step(
        project=project,
        proposer=lambda ctx: CommitmentProposal(
            capability_id="ops.measure_supplier_risk",
            arguments={"metric": "supplier_risk"},
            touched_scope=(ctx.subject_ref,),
            expected_observation={"kind": "measurement.sampled", "required": True},
            expected_outcome={"status": "ok", "required": True},
        ),
        commitment_id_factory=lambda project: f"commitment:{project.id}:1",
        opened_at=now,
    )

    assert created is not None
    assert created.commitment_id == f"commitment:{project.id}:1"
    assert created.status == "active"


@pytest.mark.django_db
def test_run_control_step_rejects_unauthorized_capability_during_activation():
    user = get_user_model().objects.create_user(username="gda-loop-auth", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
    run_spec = compile_run_spec_for_project(
        project=project,
        task_bundle={
            "title": "Handle supplier delay",
            "goals": (
                {
                    "goal_id": "goal-1",
                    "name": "assess supplier impact",
                    "desired_state": {"supplier_risk_assessed": True},
                },
            ),
            "allowed_capabilities": ("ops.measure_supplier_risk",),
        },
        now=now,
        world_ref=world_ref(project.id),
    )
    persist_run_spec_state(project=project, run_spec=run_spec, status="running")

    with pytest.raises(CommitmentAuthorizationError, match="not authorized"):
        run_control_step(
            project=project,
            proposer=lambda ctx: CommitmentProposal(
                capability_id="ops.reply_supplier",
                arguments={"template": "delay-followup"},
                touched_scope=(ctx.subject_ref,),
            ),
            commitment_id_factory=lambda project: f"commitment:{project.id}:unauthorized",
            opened_at=now,
        )


@pytest.mark.django_db
def test_update_commitment_status_closes_terminal_commitment():
    user = get_user_model().objects.create_user(username="gda-status", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    commitment = ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )
    closed_at = datetime(2026, 3, 31, 12, 30, tzinfo=timezone.utc)

    updated = update_commitment_status(
        project=project,
        commitment_id=commitment.commitment_id,
        status="satisfied",
        close_reason="completed",
        closed_at=closed_at,
    )

    assert updated.status == "satisfied"
    assert updated.close_reason == "completed"
    assert updated.closed_at == closed_at


@pytest.mark.django_db
def test_update_commitment_status_is_idempotent_for_same_terminal_result():
    user = get_user_model().objects.create_user(username="gda-status-idempotent", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )
    closed_at = datetime(2026, 3, 31, 12, 30, tzinfo=timezone.utc)

    first = update_commitment_status(
        project=project,
        commitment_id="commitment-1",
        status="satisfied",
        close_reason="completed",
        closed_at=closed_at,
    )
    second = update_commitment_status(
        project=project,
        commitment_id="commitment-1",
        status="satisfied",
        close_reason="completed",
        closed_at=closed_at,
    )

    assert second.id == first.id
    assert second.status == "satisfied"


@pytest.mark.django_db
def test_update_commitment_status_rejects_conflicting_terminal_retry():
    user = get_user_model().objects.create_user(username="gda-status-conflict", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
    )
    first_closed_at = datetime(2026, 3, 31, 12, 30, tzinfo=timezone.utc)
    second_closed_at = datetime(2026, 3, 31, 12, 31, tzinfo=timezone.utc)
    update_commitment_status(
        project=project,
        commitment_id="commitment-1",
        status="satisfied",
        close_reason="completed",
        closed_at=first_closed_at,
    )

    with pytest.raises(CommitmentConflictError, match="closed_at conflict"):
        update_commitment_status(
            project=project,
            commitment_id="commitment-1",
            status="satisfied",
            close_reason="completed",
            closed_at=second_closed_at,
        )


@pytest.mark.django_db
def test_process_runtime_completion_satisfies_commitment_when_expectations_are_met():
    user = get_user_model().objects.create_user(username="gda-runtime-ok", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
        expected_observation={"kind": "measurement.sampled", "required": True},
        expected_outcome={"status": "ok", "required": True},
    )
    completed_at = datetime(2026, 3, 31, 12, 45, tzinfo=timezone.utc)

    result = process_runtime_completion(
        project=project,
        outcome=ExecutionOutcome(
            invocation_id="invoke-1",
            commitment_id="commitment-1",
            status="ok",
            resource_usage={"tokens": 12.0},
            artifact_refs=("artifact:risk-report",),
        ),
        observations=(
            Observation(
                observation_id="obs-measurement-1",
                subject=f"project://{project.id}",
                kind="measurement.sampled",
                observed_at=completed_at,
                valid_at=completed_at,
                source=ObservationSource(kind="subagent", source_id="worker-1"),
                payload={"metric": "supplier_risk", "value": 0.8},
                provenance_refs=("artifact:risk-report",),
            ),
        ),
        known_source_kinds=("subagent",),
        completed_at=completed_at,
    )

    assert result.execution.status == "ok"
    assert len(result.observations) == 1
    assert result.commitment is not None
    assert result.commitment.status == "satisfied"
    assert result.commitment.close_reason == "completed"


@pytest.mark.django_db
def test_process_runtime_completion_breaches_commitment_when_observation_is_missing():
    user = get_user_model().objects.create_user(username="gda-runtime-missing", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
        expected_observation={"kind": "measurement.sampled", "required": True},
        expected_outcome={"status": "ok", "required": True},
    )
    completed_at = datetime(2026, 3, 31, 12, 45, tzinfo=timezone.utc)

    result = process_runtime_completion(
        project=project,
        outcome=ExecutionOutcome(
            invocation_id="invoke-1",
            commitment_id="commitment-1",
            status="ok",
        ),
        observations=(),
        completed_at=completed_at,
    )

    assert result.commitment is not None
    assert result.commitment.status == "failed"
    assert result.commitment.close_reason == "missing_observation:measurement.sampled"


@pytest.mark.django_db
def test_process_runtime_completion_breaches_commitment_when_outcome_status_mismatches():
    user = get_user_model().objects.create_user(username="gda-runtime-fail", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
        expected_outcome={"status": "ok", "required": True},
    )
    completed_at = datetime(2026, 3, 31, 12, 45, tzinfo=timezone.utc)

    result = process_runtime_completion(
        project=project,
        outcome=ExecutionOutcome(
            invocation_id="invoke-1",
            commitment_id="commitment-1",
            status="error",
            metadata={"reason": "tool timeout"},
        ),
        completed_at=completed_at,
    )

    assert result.commitment is not None
    assert result.commitment.status == "failed"
    assert result.commitment.close_reason == "outcome_status_mismatch:ok"


@pytest.mark.django_db
def test_process_runtime_completion_is_idempotent_for_same_invocation_and_observations():
    user = get_user_model().objects.create_user(username="gda-runtime-idempotent", password="test")
    project = Project.objects.create(name="OpenVending Ops", owner=user)
    ProjectCommitment.objects.create(
        project=project,
        commitment_id="commitment-1",
        objective_id="objective-1",
        capability_id="ops.measure_supplier_risk",
        status="active",
        expected_observation={"kind": "measurement.sampled", "required": True},
        expected_outcome={"status": "ok", "required": True},
    )
    completed_at = datetime(2026, 3, 31, 12, 45, tzinfo=timezone.utc)
    outcome = ExecutionOutcome(
        invocation_id="invoke-1",
        commitment_id="commitment-1",
        status="ok",
        artifact_refs=("artifact:risk-report",),
    )
    observations = (
        Observation(
            observation_id="obs-measurement-1",
            subject=f"project://{project.id}",
            kind="measurement.sampled",
            observed_at=completed_at,
            valid_at=completed_at,
            source=ObservationSource(kind="subagent", source_id="worker-1"),
            payload={"metric": "supplier_risk", "value": 0.8},
            provenance_refs=("artifact:risk-report",),
        ),
    )

    first = process_runtime_completion(
        project=project,
        outcome=outcome,
        observations=observations,
        known_source_kinds=("subagent",),
        completed_at=completed_at,
    )
    second = process_runtime_completion(
        project=project,
        outcome=outcome,
        observations=observations,
        known_source_kinds=("subagent",),
        completed_at=completed_at,
    )

    assert ProjectExecution.objects.filter(project=project).count() == 1
    assert ProjectObservation.objects.filter(project=project).count() == 1
    assert second.execution.id == first.execution.id
    assert second.observations[0].id == first.observations[0].id
    assert second.commitment is not None
    assert second.commitment.status == "satisfied"
