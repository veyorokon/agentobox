import uuid

from django.db import models


class AgentStatus(models.TextChoices):
    DEPLOYING = "deploying"
    RUNNING = "running"
    IDLE = "idle"
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

    # MCP server config: {"server-name": {"command": "...", "args": [...]}}
    mcp_servers = models.JSONField(default=dict, blank=True)

    # Host path to bind-mount into the container as /home/computeruse/workspace
    workspace_path = models.CharField(max_length=500, blank=True)

    # Role instructions injected into CLAUDE.md
    instructions = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.status})"


class AgentEvent(models.Model):
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=50)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.event_type} → {self.agent.name} ({self.created_at:%H:%M})"


class AgentMessage(models.Model):
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="messages")
    direction = models.CharField(
        max_length=10, choices=[("inbound", "Inbound"), ("outbound", "Outbound")]
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.direction} → {self.agent.name} ({self.created_at:%H:%M})"


