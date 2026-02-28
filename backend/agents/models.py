import uuid

from django.db import models


class AgentStatus(models.TextChoices):
    DEPLOYING = "deploying"
    RUNNING = "running"
    WAITING = "waiting"
    IDLE = "idle"
    STOPPED = "stopped"
    ERROR = "error"



class ProjectSecret(models.Model):
    """
    Individual secret at project level. Fernet-encrypted value.

    Default: all agents in the project receive this secret.
    If scoped_agents is non-empty, only those agents receive it.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="secrets"
    )
    key = models.CharField(max_length=255)
    encrypted_value = models.BinaryField()
    scoped_agents = models.ManyToManyField(
        "Agent", blank=True, related_name="scoped_secrets"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "key"], name="unique_project_secret_key"
            ),
        ]
        ordering = ["key"]

    def __str__(self):
        return f"{self.key} → {self.project.name}"


class Skill(models.Model):
    """Project-scoped skill — markdown content injected into agent workspaces.

    Skills connect to agents via tags: if an agent's tags overlap with a
    skill's assigned_tags, the skill is written as .claude/skills/<name>/SKILL.md
    during provisioning.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="skills"
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    content = models.TextField()
    assigned_tags = models.JSONField(default=list)
    assigned_to_all = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"], name="unique_project_skill"
            ),
        ]

    def __str__(self):
        return f"{self.name} → {self.project.name}"


class Agent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._original_status = instance.status
        return instance
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

    # ── State facets ──────────────────────────────────────────────────
    # Fields synchronized to the in-container relay at session launch.
    # The DB is the source of truth; the relay reads these via env vars
    # or _build_options() and passes them to ClaudeAgentOptions.
    #
    # To add a new facet:
    #   1. Add the field here
    #   2. Wire it in lifecycle.py (provision → relay env) or relay.py (_build_options)
    #   3. If live-updatable: add a set_* service function in comms.py
    #      that saves to DB + pushes command to relay (see set_agent_mode)
    #   4. If provision-only: just save to DB — next spawn picks it up
    #
    # Current facets: model, permission_mode, allowed_tools, mcp_servers
    model = models.CharField(max_length=100, blank=True)
    permission_mode = models.CharField(max_length=30, blank=True)
    # Pre-authorized tool names — SDK skips can_use_tool callback for these.
    # Populated by "Always Allow" on permission cards. Provision-only facet:
    # changes take effect on next spawn, no live push needed.
    allowed_tools = models.JSONField(default=list, blank=True)

    # MCP server config: {"server-name": {"command": "...", "args": [...]}}
    mcp_servers = models.JSONField(default=dict, blank=True)

    # Host path to bind-mount into the container as /home/agent/workspace
    workspace_path = models.CharField(max_length=500, blank=True)

    # Explicit volume mounts: [{"name": "...", "mount_path": "...", "host_path": "", "read_only": false}]
    volume_mounts = models.JSONField(default=list, blank=True)

    # Role instructions injected into CLAUDE.md
    instructions = models.TextField(blank=True)

    # Team configuration
    role = models.CharField(
        max_length=10,
        choices=[("lead", "Lead"), ("worker", "Worker")],
        default="worker"
    )
    config_snapshot = models.JSONField(default=dict, blank=True)

    # Agent type determines which adapter extracts display fields from snapshots
    agent_type = models.CharField(max_length=50, default="claude-code")
    # Latest snapshot: {"assistant": <event>, "result": <event>}
    # Written by stream.py, read by adapters via GraphQL resolvers
    latest_snapshot = models.JSONField(default=dict, blank=True)

    # Materialized view of agent state — updated as side effects of
    # StreamEvent processing. These are denormalized for fast reads;
    # the source of truth is the StreamEvent log.
    session_cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    capabilities = models.JSONField(null=True, blank=True)
    # Current activity phase from stream_event (thinking, responding, tool-input, tool-use)
    phase = models.CharField(max_length=20, blank=True, default="")

    # Frontend-facing state
    mode = models.CharField(max_length=20, default="auto")               # auto | plan | supervised
    attention_level = models.CharField(max_length=20, default="none")     # none | review | plan | permission
    task = models.CharField(max_length=500, blank=True, default="")       # current task description
    tags = models.JSONField(default=list, blank=True)                      # string tags for grouping

    # Auth token for WebSocket relay connection (generated during provisioning)
    relay_token = models.CharField(max_length=64, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"], name="unique_project_agent_name"
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.status})"



class StreamEvent(models.Model):
    """Append-only event log. Replaces Message + AgentEvent.

    Every stream-json event from the relay, every dashboard-initiated
    message, every status transition = one row. No upserts, no row locks.

    This is deliberately a dumb append-only log. The relay forwards ALL
    Claude Code stream-json events verbatim — no filtering, no batching,
    no transformation. Intelligence lives in the read path (the frontend),
    not the write path.

    Why store everything:
    - Thinking content, tool progress, rate limits, content deltas —
      all captured automatically without code changes when Anthropic
      adds new event types to stream-json.
    - The data field is the RAW event dict. No normalization, no schema.
      We are an event log, not a relational model.

    message_id groups content parts of the same logical message
    (multiple assistant events share an Anthropic message ID).
    Empty for standalone events (status, error, result).
    """
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="stream_events")
    session_id = models.CharField(max_length=100, db_index=True)
    event_type = models.CharField(max_length=50)
    message_id = models.CharField(max_length=100, blank=True, db_index=True)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["agent", "created_at"]),
            models.Index(fields=["agent", "session_id", "created_at"]),
        ]

    def __str__(self):
        return f"{self.event_type} → {self.agent.name} ({self.created_at:%H:%M})"



class SessionResult(models.Model):
    """
    Cost and usage from Claude Code's stream-json `result` events.

    One row per turn (inserted, not upserted). `result` fires after each
    turn with cumulative totals, so each row is a point-in-time snapshot
    of the session's cost/usage. This gives us a full cost timeline for
    the agent_feed query's cumulative_cost_usd field.

    To get the latest state: .filter(agent=agent).order_by("-updated_at").first()
    To get the full timeline: .filter(agent=agent).order_by("created_at")

    Field mapping from Claude Code stream-json:
        is_error         <- event.is_error
        total_cost_usd   <- event.total_cost_usd (cumulative across turns)
        duration_ms      <- event.duration_ms (total wall time)
        duration_api_ms  <- event.duration_api_ms (API time only; diff = tool exec time)
        num_turns        <- event.num_turns (conversation depth)
        model_usage      <- event.modelUsage (per-model cost/token breakdown)
        permission_denials <- event.permission_denials

    See: docs/ARCHITECTURE.md, "result event"
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
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["agent", "created_at"]),
        ]

    def __str__(self):
        return f"session {self.session_id[:12]} ${self.total_cost_usd} → {self.agent.name}"


class AgentTask(models.Model):
    """Task created by an agent via Claude Code's native TaskCreate tool.

    Synced from stream observation — when an agent calls TaskCreate/TaskUpdate,
    we mirror the task here for dashboard visibility.
    """
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="tasks")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE)
    task_id = models.CharField(max_length=64)  # Claude's internal task ID
    subject = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=32, default="pending")
    owner = models.CharField(max_length=255, blank=True)
    active_form = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    blocks = models.JSONField(default=list, blank=True)       # task_ids this blocks
    blocked_by = models.JSONField(default=list, blank=True)   # task_ids blocking this
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "task_id"], name="unique_project_task_id"
            ),
        ]
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.subject[:50]} ({self.status}) -> {self.agent.name}"


class TeamFeedItem(models.Model):
    """Curated feed items for the dashboard team feed.

    Flat union: every field on every row, null/empty where not applicable.
    Matches the frontend's discriminated union TeamFeedItem type.
    StreamEvent = raw audit log (untouched). TeamFeedItem = dashboard view.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="feed_items")

    # Discriminator
    type = models.CharField(max_length=30)
    # system | user | summary | status | error | question | plan | permission | multi-question | agent-message | task

    # Shared
    agent_name = models.CharField(max_length=100, blank=True, default="")
    text = models.TextField(blank=True, default="")

    # Permission
    command = models.TextField(blank=True, default="")
    risk = models.CharField(max_length=200, blank=True, default="")
    perm_status = models.CharField(max_length=20, blank=True, default="")
    tool_use_id = models.CharField(max_length=100, blank=True, default="")

    # Plan
    title = models.CharField(max_length=500, blank=True, default="")
    plan = models.TextField(blank=True, default="")
    plan_status = models.CharField(max_length=20, blank=True, default="")

    # Summary
    summary = models.TextField(blank=True, default="")
    cost = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)
    turns = models.IntegerField(null=True, blank=True)
    duration = models.CharField(max_length=30, blank=True, default="")
    is_error = models.BooleanField(null=True, blank=True)

    # Status change / agent-message (from/to serve double duty)
    from_value = models.CharField(max_length=100, blank=True, default="")
    to_value = models.CharField(max_length=100, blank=True, default="")

    # User message
    target = models.CharField(max_length=100, blank=True, default="")

    # Question
    question = models.CharField(max_length=1000, blank=True, default="")
    options = models.JSONField(default=list, blank=True)
    questions = models.JSONField(default=list, blank=True)

    # Traceability
    agent_record = models.ForeignKey(Agent, on_delete=models.SET_NULL, null=True, blank=True, related_name="feed_items")
    source_event = models.ForeignKey(StreamEvent, on_delete=models.SET_NULL, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["project", "created_at"]),
            models.Index(fields=["project", "agent_name", "type", "perm_status"]),
        ]

    def __str__(self):
        return f"{self.type} ({self.agent_name}) {self.created_at:%H:%M}"


class AgentFeedback(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="feedback")
    session_id = models.CharField(max_length=255, blank=True)
    rating = models.IntegerField()
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"rating={self.rating} → {self.agent.name} ({self.created_at:%H:%M})"


