from django.contrib import admin

from agents.models import (
    Agent,
    AgentEvent,
    AgentUsage,
    Case,
    Goal,
    GoalTrajectory,
)


@admin.register(Goal)
class GoalAdmin(admin.ModelAdmin):
    list_display = ["text", "project", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["text"]


@admin.register(GoalTrajectory)
class GoalTrajectoryAdmin(admin.ModelAdmin):
    list_display = ["goal", "trigger", "timestamp"]
    list_filter = ["trigger"]


@admin.register(Agent)
class AgentAdmin(admin.ModelAdmin):
    list_display = ["name", "project", "status", "runtime", "confidence", "created_at"]
    list_filter = ["status", "runtime"]
    search_fields = ["name"]


@admin.register(AgentEvent)
class AgentEventAdmin(admin.ModelAdmin):
    list_display = ["agent", "event_type", "timestamp"]
    list_filter = ["event_type"]


@admin.register(Case)
class CaseAdmin(admin.ModelAdmin):
    list_display = ["goal_text", "outcome", "duration_seconds", "created_at"]
    list_filter = ["outcome"]
    search_fields = ["goal_text"]


@admin.register(AgentUsage)
class AgentUsageAdmin(admin.ModelAdmin):
    list_display = ["agent", "input_tokens", "output_tokens", "timestamp"]
