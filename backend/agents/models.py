"""
Domain models for the agents app.

Defines the core entities: Agent, StreamEvent, SessionResult, TeamFeedItem,
AgentTask, ProjectSecret, Skill, AgentFeedback. Agent is the central record
tracking a single Claude Code container — its runtime, configuration, session
state, and materialized view fields. StreamEvent is the append-only event log
(INSERT only, never UPDATE) that captures every relay event verbatim.
TeamFeedItem is the curated dashboard feed — a flat union where every row has
all fields, nulled where inapplicable, matching the frontend's discriminated
union type.

Key design decisions:
- Agent config (model, mode, mcp_servers, allowed_tools) is written to the
  shared volume at provisioning time. The relay reads config from volume
  files, not DB fields. DB fields are kept for GraphQL queries and as the
  source of truth for what SHOULD be on the volume.
- SessionResult is INSERT-per-turn (not upserted) so we get a full cost
  timeline, not just latest values.
- config_snapshot captures creation-time config so hard_restart can
  reprovision identically without re-resolving defaults.
"""
import uuid

from django.conf import settings
from django.db import models


class DesiredStatus(models.TextChoices):
    """Backend-owned intent — what the user wants this agent to be doing."""
    DEPLOYED = "deployed"
    STOPPED = "stopped"


class AgentStatus(models.TextChoices):
    """Runtime-reported state — cached projection of what the agent reports."""
    DEPLOYING = "deploying"
    RUNNING = "running"
    WAITING = "waiting"
    IDLE = "idle"
    STOPPED = "stopped"
    ERROR = "error"


class AgentLifecycleKind(models.TextChoices):
    CREATE = "create"
    RESTART = "restart"


class AgentLifecycleAttemptStatus(models.TextChoices):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class IllegalTransitionError(Exception):
    """Raised when an agent status transition violates the state machine.

    Error code: ERR-LIFECYCLE-STATE-ILLEGAL
    """

    def __init__(self, agent_id, from_status, to_status):
        self.agent_id = agent_id
        self.from_status = from_status
        self.to_status = to_status
        super().__init__(
            f"ERR-LIFECYCLE-STATE-ILLEGAL: cannot transition agent {agent_id} "
            f"from {from_status} to {to_status}"
        )


VALID_TRANSITIONS: dict[str, set[str]] = {
    AgentStatus.DEPLOYING: {AgentStatus.IDLE, AgentStatus.ERROR, AgentStatus.STOPPED},
    AgentStatus.IDLE: {AgentStatus.RUNNING, AgentStatus.ERROR, AgentStatus.STOPPED, AgentStatus.DEPLOYING},
    AgentStatus.RUNNING: {AgentStatus.IDLE, AgentStatus.WAITING, AgentStatus.ERROR, AgentStatus.STOPPED},
    AgentStatus.WAITING: {AgentStatus.RUNNING, AgentStatus.IDLE, AgentStatus.ERROR, AgentStatus.STOPPED},
    AgentStatus.ERROR: {AgentStatus.DEPLOYING, AgentStatus.STOPPED, AgentStatus.ERROR},
    AgentStatus.STOPPED: {AgentStatus.DEPLOYING},
}


class FeedItemType(models.TextChoices):
    SYSTEM = "system"
    USER = "user"
    SUMMARY = "summary"
    STATUS = "status"
    ERROR = "error"
    QUESTION = "question"
    PLAN = "plan"
    PERMISSION = "permission"
    MULTI_QUESTION = "multi-question"
    AGENT_MESSAGE = "agent-message"
    TASK = "task"



class AccountSecret(models.Model):
    """Account-level secret. Fernet-encrypted value.

    Inherited by all projects owned by this user unless overridden
    by a ProjectSecret with the same key.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="account_secrets"
    )
    key = models.CharField(max_length=255)
    encrypted_value = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "key"], name="unique_account_secret_key"
            ),
        ]
        ordering = ["key"]

    def __str__(self):
        return f"{self.key} → {self.user.username} (account)"


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


class AgentQuerySet(models.QuerySet):
    """Domain queries for agents. Use Agent.objects.<method>()."""

    def alive(self):
        """Agents that are not in a terminal state."""
        return self.exclude(status__in=(AgentStatus.STOPPED, AgentStatus.ERROR))

    def for_project(self, project_id):
        return self.filter(project_id=project_id)

    def needing_reconcile(self):
        """Agents where desired state != reported state."""
        from django.db.models import Q
        return self.filter(
            Q(desired_status=DesiredStatus.DEPLOYED) & Q(status__in=(AgentStatus.STOPPED, AgentStatus.ERROR))
            | Q(desired_status=DesiredStatus.STOPPED) & ~Q(status=AgentStatus.STOPPED)
        )

    def stuck_deploys(self, threshold):
        """Agents stuck in DEPLOYING past the given datetime threshold."""
        return self.filter(status=AgentStatus.DEPLOYING, updated_at__lt=threshold)


class Agent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)

    objects = AgentQuerySet.as_manager()

    @classmethod
    def from_db(cls, db, field_names, values):
        """Capture original status on load for change detection in save()."""
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
    desired_status = models.CharField(
        max_length=20, choices=DesiredStatus.choices, default=DesiredStatus.DEPLOYED
    )
    team_name = models.CharField(max_length=100, blank=True)
    parent_session_id = models.CharField(max_length=255, blank=True)
    session_id = models.CharField(max_length=255, blank=True)

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
    # Last known runtime-owned machine status projected into the control plane.
    # This is a backend-visible cache of agent-owned truth, not an independent
    # source of runtime state.
    runtime_status_projection = models.JSONField(default=dict, blank=True)
    # Current activity phase from stream_event (thinking, responding, tool-input, tool-use)
    phase = models.CharField(max_length=20, blank=True, default="")

    # Frontend-facing state
    mode = models.CharField(max_length=20, default="auto")               # auto | plan | supervised
    # review is a local/card/feed signal; plan/permission require user intervention.
    attention_level = models.CharField(max_length=20, default="none")     # none | review | plan | permission
    task = models.CharField(max_length=500, blank=True, default="")       # current task description
    tags = models.JSONField(default=list, blank=True)                      # string tags for grouping

    # Task timing — set by consumer on task_update and execution_event.
    # Used for watchdog classification (hung, failed-fast, silent).
    task_started_at = models.DateTimeField(null=True, blank=True)
    last_execution_event_at = models.DateTimeField(null=True, blank=True)

    # Last error context — stderr excerpt or crash diagnostics.
    # Written by stream.py (process_exit) or reconcile.py (dead container).
    # Cleared on successful restart.
    error_message = models.TextField(blank=True, default="")

    # Auth token for WebSocket relay connection (generated during provisioning)
    relay_token = models.CharField(max_length=64, blank=True, db_index=True)
    # Whether the relay WebSocket is currently connected to this agent
    relay_connected = models.BooleanField(default=False)
    # Timestamp of last relay WS disconnect — used to backfill messages
    # sent while the relay was transiently disconnected.
    relay_disconnected_at = models.DateTimeField(null=True, blank=True)

    # ── Trigger configuration ─────────────────────────────────────────
    # Array of trigger objects that control what wakes this agent.
    # Each element: {"type": "cron"|"webhook"|"manual", "schedule": "0 9 * * *",
    #   "message": "run daily check", "last_triggered_at": "2026-03-06T..."}
    # Types: "cron" (schedule field, cron expression), "webhook" (external HTTP POST),
    #   "manual" (default, wake on user message)
    # Empty list = manual only (current behavior, backward compatible).
    triggers = models.JSONField(default=list, blank=True)

    # ── Compute tracking ──────────────────────────────────────────────
    # Accumulated container runtime in seconds. Updated when agent stops/terminates.
    # For running agents, compute total as: compute_seconds + (now - deployed_at).seconds
    compute_seconds = models.BigIntegerField(default=0)

    # When the agent's relay connected and it became operational (IDLE).
    # Used to calculate elapsed compute time on status transitions.
    # Cleared on stop/error, set on relay connect (consumers.py).
    deployed_at = models.DateTimeField(null=True, blank=True)

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

    @property
    def machine(self):
        """Canonical machine-state interface for this agent."""
        from agents.runtimes import get_runtime
        from agents.services.volume import AgentMachine

        return AgentMachine(
            str(self.project_id),
            str(self.id),
            store=get_runtime(self.runtime).machine_store(),
        )

    @property
    def volume(self):
        """Compatibility alias for the older storage-centric name."""
        return self.machine

    @property
    def is_converged(self):
        """Desired state matches reported state — no action needed."""
        from agents.services.runtime_projection import agent_meets_ready_boundary

        if self.desired_status == DesiredStatus.DEPLOYED:
            return (
                self.status in (AgentStatus.IDLE, AgentStatus.RUNNING, AgentStatus.WAITING)
                and agent_meets_ready_boundary(self)
            )
        return self.status == AgentStatus.STOPPED

    @property
    def needs_reconcile(self):
        """Desired state does not match reported state — drift detected."""
        if self.desired_status == DesiredStatus.DEPLOYED:
            return self.status not in (AgentStatus.IDLE, AgentStatus.RUNNING, AgentStatus.WAITING)
        return self.status != AgentStatus.STOPPED

    @property
    def compute_seconds_live(self):
        """compute_seconds + current segment if container is still running.

        compute_seconds is a materialized cache updated on stop/error.
        For running agents, add the elapsed time since deployed_at.
        """
        from django.utils import timezone

        base = self.compute_seconds or 0
        if self.deployed_at and self.status not in (
            AgentStatus.STOPPED, AgentStatus.ERROR,
        ):
            base += int((timezone.now() - self.deployed_at).total_seconds())
        return base

    async def get_runtime_history(self):
        """Full runtime segments derived from status transition StreamEvents.

        Returns list of {"start": datetime, "end": datetime, "seconds": int}
        dicts. This is the source of truth — compute_seconds is just a
        materialized cache of sum(segment.seconds for all segments).
        """
        events = (
            StreamEvent.objects.filter(
                agent_id=self.id,
                event_type="status",
            )
            .order_by("created_at")
            .values_list("data", "created_at")
        )
        segments = []
        deploy_start = None
        async for data, created_at in events:
            to_status = data.get("to", "") if isinstance(data, dict) else ""
            if to_status in (AgentStatus.DEPLOYING, AgentStatus.IDLE) and deploy_start is None:
                deploy_start = created_at
            elif to_status in (AgentStatus.STOPPED, AgentStatus.ERROR) and deploy_start:
                seconds = int((created_at - deploy_start).total_seconds())
                segments.append({
                    "start": deploy_start,
                    "end": created_at,
                    "seconds": seconds,
                })
                deploy_start = None
        return segments


class AgentLifecycleAttempt(models.Model):
    """Durable record of a create/restart lifecycle attempt for an agent."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    agent = models.ForeignKey(
        Agent, on_delete=models.CASCADE, related_name="lifecycle_attempts"
    )
    kind = models.CharField(max_length=20, choices=AgentLifecycleKind.choices)
    status = models.CharField(
        max_length=20,
        choices=AgentLifecycleAttemptStatus.choices,
        default=AgentLifecycleAttemptStatus.RUNNING,
    )
    step = models.CharField(max_length=64, default="queued")
    attempt_no = models.PositiveIntegerField(default=1)
    correlation_id = models.CharField(max_length=64, blank=True, default="")
    error_code = models.CharField(max_length=64, blank=True, default="")
    error_detail = models.TextField(blank=True, default="")
    metadata_json = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["agent", "status", "started_at"]),
            models.Index(fields=["correlation_id"]),
        ]

    def __str__(self):
        return f"{self.kind}:{self.status}:{self.agent.name}:{self.step}"



class _CanonicalManager(models.Manager):
    """Projection: only canonical (CC-format) events for frontend rendering."""

    def get_queryset(self):
        return super().get_queryset().filter(is_canonical=True)


class _RawManager(models.Manager):
    """Projection: only raw agent-native events for debugging/telemetry."""

    def get_queryset(self):
        return super().get_queryset().filter(is_canonical=False)


class StreamEvent(models.Model):
    """Append-only event log — raw events + canonical projections.

    Two roles in one table (Event Sourcing + Materialized Projection):

        StreamEvent.objects    — all events (raw + canonical)
        StreamEvent.canonical  — CC-format events for rendering + side effects
        StreamEvent.raw        — agent-native events for debugging/replay

    Every event from a relay gets one raw INSERT (verbatim, never transformed).
    The adapter's normalize() then projects 0+ canonical CC-format events that
    are stored separately for the frontend and side effect processing.

    For agents whose native format IS CC (Claude Code), raw = canonical — one
    row with is_canonical=True serves both roles (no duplication). For agents
    with non-CC formats (OpenCode), raw events have is_canonical=False and
    canonical projections have is_canonical=True.

    message_id groups content parts of the same logical message
    (multiple assistant events share an Anthropic message ID).
    Empty for standalone events (status, error, result).
    """
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="stream_events")
    session_id = models.CharField(max_length=100, db_index=True)
    task_id = models.CharField(max_length=64, blank=True, db_index=True)
    event_type = models.CharField(max_length=50)
    message_id = models.CharField(max_length=100, blank=True, db_index=True)
    data = models.JSONField(default=dict)
    is_canonical = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = models.Manager()
    canonical = _CanonicalManager()
    raw = _RawManager()

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


class RuntimeSegment(models.Model):
    """One runtime-compute segment for provider-attributed usage.

    A segment opens when an agent becomes operational (deployed_at set) and closes
    when the runtime stops, errors, or is explicitly terminated. This is the
    durable ledger for provider-side compute facts, separate from model-token cost.
    """

    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="runtime_segments")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="runtime_segments")
    provider = models.CharField(max_length=32, default="")
    sandbox_id = models.CharField(max_length=100, blank=True, db_index=True)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField()
    compute_seconds = models.BigIntegerField(default=0)
    close_reason = models.CharField(max_length=64, blank=True, default="")
    cpu_cores = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    memory_mb = models.IntegerField(default=0)
    metadata_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["agent", "started_at"]),
            models.Index(fields=["project", "started_at"]),
            models.Index(fields=["provider", "started_at"]),
            models.Index(fields=["sandbox_id"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["agent", "provider", "sandbox_id", "started_at"],
                name="agents_runtime_segment_unique_start",
            ),
        ]

    def __str__(self):
        return f"{self.provider}:{self.compute_seconds}s:{self.agent.name}"


class AgentTask(models.Model):
    """Task created by an agent via Claude Code's native TaskCreate tool.

    Synced from stream observation — when an agent calls TaskCreate/TaskUpdate,
    we mirror the task here for dashboard visibility.
    """
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="tasks")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE)
    task_id = models.CharField(max_length=64)  # Claude's internal task ID
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=32, default="pending")
    assignee = models.CharField(max_length=255, blank=True)
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
        return f"{self.title[:50]} ({self.status}) -> {self.agent.name}"


class TeamFeedItem(models.Model):
    """Curated feed items for the dashboard team feed.

    Flat union: every field on every row, null/empty where not applicable.
    Matches the frontend's discriminated union TeamFeedItem type.
    StreamEvent = raw audit log (untouched). TeamFeedItem = dashboard view.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="feed_items")

    # Discriminator
    type = models.CharField(max_length=30, choices=FeedItemType.choices)

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
    updated_at = models.DateTimeField(auto_now=True)

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
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"rating={self.rating} → {self.agent.name} ({self.created_at:%H:%M})"


class IncidentCapture(models.Model):
    """Stored incident diagnosis bundle for an agent.

    Captures a bounded, redacted snapshot of agent state, recent events,
    runtime logs, and lifecycle attempts at the moment of report. Used for
    dogfooding and debugging seam failures without manually gathering evidence.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="incidents"
    )
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="incidents")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="incidents"
    )
    note = models.TextField(blank=True, default="")
    screenshot_url = models.URLField(blank=True, default="")
    window_minutes = models.IntegerField(default=30)
    bundle = models.JSONField(default=dict)
    collection_errors = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "created_at"]),
            models.Index(fields=["agent", "created_at"]),
        ]

    def __str__(self):
        return f"incident {str(self.id)[:8]} → {self.agent.name} ({self.created_at:%H:%M})"
