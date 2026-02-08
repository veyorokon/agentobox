import uuid

from django.db import models


class AgentStatus(models.TextChoices):
    DEPLOYING = "deploying"
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"


class Agent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.CharField(max_length=100)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="agents"
    )
    runtime = models.CharField(
        max_length=20, choices=[("modal", "Modal"), ("docker", "Docker")]
    )
    sandbox_id = models.CharField(max_length=255, blank=True)
    vnc_url = models.URLField(blank=True)

    status = models.CharField(
        max_length=20, choices=AgentStatus.choices, default=AgentStatus.DEPLOYING
    )
    team_name = models.CharField(max_length=100, blank=True)
    parent_session_id = models.CharField(max_length=255, blank=True)
    session_id = models.CharField(max_length=255, blank=True)

    # Claude Code native fields (updated from hook common fields)
    model = models.CharField(max_length=100, blank=True)
    cwd = models.CharField(max_length=500, blank=True)
    transcript_path = models.CharField(max_length=500, blank=True)
    permission_mode = models.CharField(max_length=30, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.status})"


