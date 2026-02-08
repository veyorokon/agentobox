from django.contrib import admin

from agents.models import Agent


@admin.register(Agent)
class AgentAdmin(admin.ModelAdmin):
    list_display = ["name", "project", "status", "runtime", "created_at"]
    list_filter = ["status", "runtime"]
    search_fields = ["name"]
