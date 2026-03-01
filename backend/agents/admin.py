"""
Django admin registration for agent models.

Registers Agent with list display, filters, and search. Other models
(StreamEvent, SessionResult, etc.) are intentionally excluded — they're
high-volume append-only logs better inspected via GraphQL or shell.
"""
from django.contrib import admin

from agents.models import Agent


@admin.register(Agent)
class AgentAdmin(admin.ModelAdmin):
    list_display = ["name", "project", "status", "runtime", "created_at"]
    list_filter = ["status", "runtime"]
    search_fields = ["name"]
