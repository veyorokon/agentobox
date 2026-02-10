import uuid

from django.db import models


class AgentStatus(models.TextChoices):
    DEPLOYING = "deploying"
    RUNNING = "running"
    IDLE = "idle"
    STOPPED = "stopped"
    ERROR = "error"


class SecretGroup(models.Model):
    """
    Named collection of encrypted key-value pairs, scoped to a project.

    Secrets are Fernet-encrypted at rest. Decrypted only during agent
    provisioning to inject into MCP server env blocks or tmpfs.

    Pattern inspired by Modal's secret groups:
        modal.Secret.from_dict({"KEY": "value"})
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="secret_groups"
    )
    name = models.CharField(max_length=100)
    encrypted_data = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"], name="unique_project_secret_group"
            ),
        ]
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} → {self.project.name}"


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

    # Secret groups attached to this agent (decrypted at provisioning time)
    secret_groups = models.ManyToManyField(SecretGroup, blank=True, related_name="agents")

    # Team configuration
    role = models.CharField(
        max_length=10,
        choices=[("lead", "Lead"), ("worker", "Worker")],
        default="worker"
    )
    config_snapshot = models.JSONField(default=dict, blank=True)

    # Stream-JSON relay fields
    # Running session cost from SessionResult.total_cost_usd
    session_cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    # Tools, MCP servers, model, version from system/init event
    capabilities = models.JSONField(null=True, blank=True)
    # Queue of messages for relay piggyback (list of JSON dicts)
    pending_input = models.JSONField(default=list, blank=True)
    # Queued signal for relay piggyback (e.g. "SIGINT")
    pending_signal = models.CharField(max_length=20, blank=True)
    # Auth token for relay -> backend communication
    relay_token = models.CharField(max_length=64, blank=True)
    # Relay health inference — stale > 10s = down
    last_heartbeat_at = models.DateTimeField(null=True, blank=True)

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
    """Deprecated: kept only for AgentFeedback FK. Will be removed in a future migration."""
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


class Message(models.Model):
    """
    Mirrors Claude Code's stream-json assistant/user events.

    Each stdout event with type="assistant" or type="user" becomes one Message.
    The `parts` field stores message.content[] verbatim — the same typed array
    format used by the Anthropic Messages API and Claude Code's internal
    MessageContent type.

    CRITICAL: Assistant events carry 1 content part each. Parts are APPENDED
    to the existing list, not replaced. Same pattern as Crush's AppendContent().

    Field mapping from Claude Code stream-json:
        message_id  <- event.message.id (stable across incremental updates)
        session_id  <- event.session_id
        role        <- event.message.role ("assistant" | "user")
        model       <- event.message.model
        parts       <- event.message.content[] (ContentPart[])
        usage       <- event.message.usage (token counts with cache breakdown)
        stop_reason <- event.message.stop_reason ("end_turn" | "tool_use" | "max_tokens")
        parent_tool_use_id <- event.parent_tool_use_id (non-null for subagent responses)

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Data Model"
    See: docs/CRUSH-ARCHITECTURE.md, "Message Model" (pattern origin)
    """
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="stream_messages")
    message_id = models.CharField(max_length=100, db_index=True)
    session_id = models.CharField(max_length=100, db_index=True)
    role = models.CharField(max_length=10)  # assistant, user
    model = models.CharField(max_length=100, blank=True)
    parts = models.JSONField(default=list)
    usage = models.JSONField(null=True, blank=True)
    parent_tool_use_id = models.CharField(max_length=100, blank=True)
    stop_reason = models.CharField(max_length=20, blank=True)
    turn_number = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["agent", "session_id", "turn_number"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["agent", "message_id"], name="unique_agent_message_id"),
        ]

    def __str__(self):
        return f"{self.role} {self.message_id[:12]} → {self.agent.name}"


class SessionResult(models.Model):
    """
    Cost and usage from Claude Code's stream-json `result` events.

    Upserted by (agent, session_id) because `result` fires per-turn with
    cumulative totals — not per-session.

    Field mapping from Claude Code stream-json:
        is_error         <- event.is_error
        total_cost_usd   <- event.total_cost_usd (cumulative across turns)
        duration_ms      <- event.duration_ms (total wall time)
        duration_api_ms  <- event.duration_api_ms (API time only; diff = tool exec time)
        num_turns        <- event.num_turns (conversation depth)
        model_usage      <- event.modelUsage (per-model cost/token breakdown)
        permission_denials <- event.permission_denials

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "result event"
    """
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="session_results")
    session_id = models.CharField(max_length=100)
    is_error = models.BooleanField(default=False)
    total_cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    duration_ms = models.IntegerField(default=0)
    duration_api_ms = models.IntegerField(default=0)
    num_turns = models.IntegerField(default=0)
    model_usage = models.JSONField(default=dict)
    permission_denials = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["agent", "session_id"], name="unique_session_result"),
        ]

    def __str__(self):
        return f"session {self.session_id[:12]} ${self.total_cost_usd} → {self.agent.name}"


class AgentFeedback(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="feedback")
    message = models.ForeignKey(
        AgentMessage, on_delete=models.CASCADE, null=True, blank=True, related_name="feedback"
    )
    session_id = models.CharField(max_length=255, blank=True)
    rating = models.IntegerField()
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"rating={self.rating} → {self.agent.name} ({self.created_at:%H:%M})"


