import uuid

from django.conf import settings
from django.db import models

from agents.services.themes import (
    default_project_theme_document,
    default_theme_tokens,
    normalize_project_theme_input,
    resolve_project_theme_document,
    resolve_project_theme_tokens,
)


class ProjectQuerySet(models.QuerySet):
    def alive(self):
        return self.filter(deleted_at__isnull=True)

    def active(self):
        return self.alive().filter(archived_at__isnull=True)


class ActiveProjectManager(models.Manager):
    def get_queryset(self):
        return ProjectQuerySet(self.model, using=self._db).alive()


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="projects"
    )
    settings = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    theme_tokens = models.JSONField(default=dict, blank=True)
    theme_document = models.JSONField(default=dict, blank=True)

    objects = ActiveProjectManager()
    all_objects = ProjectQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    def resolved_theme_document(self) -> dict[str, object]:
        if self.theme_document:
            return resolve_project_theme_document(self.theme_document)
        if self.theme_tokens:
            return normalize_project_theme_input(tokens=self.theme_tokens)
        return default_project_theme_document()

    def resolved_theme_tokens(self) -> dict[str, str]:
        if self.theme_document:
            return resolve_project_theme_tokens(self.theme_document)
        if self.theme_tokens:
            return resolve_project_theme_tokens(normalize_project_theme_input(tokens=self.theme_tokens))
        return default_theme_tokens()

    def set_theme_document(
        self,
        *,
        theme: str | None = None,
        mode: str | None = None,
        overrides: dict[str, str] | None = None,
        tokens: dict[str, str] | None = None,
    ) -> dict[str, object]:
        document = normalize_project_theme_input(
            theme=theme,
            mode=mode,
            overrides=overrides,
            tokens=tokens,
        )
        self.theme_document = document
        self.theme_tokens = resolve_project_theme_tokens(document)
        return document
