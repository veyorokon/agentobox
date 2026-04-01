from django.contrib import admin

from gda.models import (
    ProjectCommitment,
    ProjectExecution,
    ProjectObservation,
    ProjectState,
)


@admin.register(ProjectState)
class ProjectStateAdmin(admin.ModelAdmin):
    list_display = ["project", "world_ref", "state_version_id", "updated_at"]
    search_fields = ["project__name", "world_ref", "run_id"]


@admin.register(ProjectObservation)
class ProjectObservationAdmin(admin.ModelAdmin):
    list_display = ["project", "kind", "source_kind", "source_id", "observed_at", "admitted_at"]
    search_fields = ["project__name", "kind", "source_kind", "source_id", "observation_id"]


@admin.register(ProjectCommitment)
class ProjectCommitmentAdmin(admin.ModelAdmin):
    list_display = ["project", "capability_id", "status", "opened_at", "closed_at"]
    search_fields = ["project__name", "commitment_id", "capability_id", "objective_id"]


@admin.register(ProjectExecution)
class ProjectExecutionAdmin(admin.ModelAdmin):
    list_display = ["project", "invocation_id", "status", "created_at", "completed_at"]
    search_fields = ["project__name", "invocation_id", "status"]
