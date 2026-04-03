import uuid

from django.db import models


class ProjectState(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.OneToOneField(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="gda_state",
    )
    world_ref = models.CharField(max_length=255, blank=True, default="")
    run_id = models.CharField(max_length=255, blank=True, default="")
    evaluator_profile = models.CharField(max_length=100, blank=True, default="")
    status = models.CharField(max_length=32, default="idle")
    subject = models.CharField(max_length=255, blank=True, default="")
    state_version_id = models.CharField(max_length=64, default="v1")
    observed_at = models.DateTimeField(null=True, blank=True)
    source_refs = models.JSONField(default=list, blank=True)
    facts = models.JSONField(default=dict, blank=True)
    objective = models.JSONField(default=dict, blank=True)
    boundary = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"{self.project.name} state"


class ProjectStateEntry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="gda_state_entries",
    )
    dimension_id = models.CharField(max_length=255)
    schema_ref = models.CharField(max_length=255)
    origin = models.CharField(max_length=32)
    value = models.JSONField(default=dict, blank=True)
    valid_from = models.DateTimeField()
    valid_until = models.DateTimeField(null=True, blank=True)
    provenance_refs = models.JSONField(default=list, blank=True)
    state_version_id = models.CharField(max_length=64, default="v1")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["dimension_id", "-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "dimension_id"],
                name="unique_project_state_entry_dimension",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project.name} state entry {self.dimension_id}"


class ProjectObservation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="gda_observations",
    )
    observation_id = models.CharField(max_length=255)
    kind = models.CharField(max_length=255)
    subject = models.CharField(max_length=255)
    observed_at = models.DateTimeField()
    valid_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    source_kind = models.CharField(max_length=128)
    source_id = models.CharField(max_length=255)
    payload = models.JSONField(default=dict, blank=True)
    provenance_refs = models.JSONField(default=list, blank=True)
    quality = models.CharField(max_length=32, default="exact")
    admitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["observed_at", "admitted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "observation_id"],
                name="unique_project_observation_id",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project.name} observation {self.kind}"


class ProjectCommitment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="gda_commitments",
    )
    commitment_id = models.CharField(max_length=255)
    objective_id = models.CharField(max_length=255)
    capability_id = models.CharField(max_length=255)
    arguments = models.JSONField(default=dict, blank=True)
    touched_scope = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=32, default="proposed")
    expected_observation = models.JSONField(default=dict, blank=True)
    expected_outcome = models.JSONField(default=dict, blank=True)
    opened_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    close_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "commitment_id"],
                name="unique_project_commitment_id",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project.name} commitment {self.capability_id}"


class ProjectCommitmentAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="gda_commitment_assignments",
    )
    commitment = models.OneToOneField(
        ProjectCommitment,
        on_delete=models.CASCADE,
        related_name="assignment",
    )
    agent = models.ForeignKey(
        "agents.Agent",
        on_delete=models.CASCADE,
        related_name="gda_commitment_assignments",
    )
    dimension_ids = models.JSONField(default=list, blank=True)
    observation_kinds = models.JSONField(default=list, blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-assigned_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "commitment", "agent"],
                name="unique_project_commitment_assignment",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project.name} assignment {self.commitment.commitment_id} -> {self.agent.name}"


class ProjectExecution(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="gda_executions",
    )
    commitment = models.ForeignKey(
        ProjectCommitment,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="executions",
    )
    invocation_id = models.CharField(max_length=255)
    status = models.CharField(max_length=32)
    resource_usage = models.JSONField(default=dict, blank=True)
    artifact_refs = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "invocation_id"],
                name="unique_project_invocation_id",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project.name} execution {self.invocation_id}"
