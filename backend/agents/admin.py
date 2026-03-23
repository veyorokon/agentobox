"""
Django admin registration for agent models.

Registers Agent with list display, filters, and search. Other models
(StreamEvent, SessionResult, etc.) are intentionally excluded — they're
high-volume append-only logs better inspected via GraphQL or shell.
"""
from django.contrib import admin

from agents.models import Agent, IncidentCapture


@admin.register(Agent)
class AgentAdmin(admin.ModelAdmin):
    list_display = ["name", "project", "status", "runtime", "created_at"]
    list_filter = ["status", "runtime"]
    search_fields = ["name"]


@admin.register(IncidentCapture)
class IncidentCaptureAdmin(admin.ModelAdmin):
    list_display = ["short_id", "agent_name", "project_name", "note_preview", "created_at"]
    list_filter = ["created_at"]
    search_fields = ["id", "agent__name", "note"]
    readonly_fields = [
        "id", "project", "agent", "created_by", "note", "screenshot_url",
        "window_minutes", "bundle", "collection_errors", "created_at",
    ]
    ordering = ["-created_at"]

    @admin.display(description="ID")
    def short_id(self, obj):
        return str(obj.id)[:8]

    @admin.display(description="Agent")
    def agent_name(self, obj):
        return obj.agent.name if obj.agent else "(deleted)"

    @admin.display(description="Project")
    def project_name(self, obj):
        return obj.project.name if obj.project else "(deleted)"

    @admin.display(description="Note")
    def note_preview(self, obj):
        return (obj.note[:80] + "…") if len(obj.note) > 80 else obj.note
