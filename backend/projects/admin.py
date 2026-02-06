from django.contrib import admin

from projects.models import Project


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ["name", "owner", "default_runtime", "created_at"]
    list_filter = ["default_runtime"]
    search_fields = ["name"]
