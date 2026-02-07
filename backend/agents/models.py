import uuid

from django.db import models
from pgvector.django import HnswIndex, VectorField


class AgentStatus(models.TextChoices):
    DEPLOYING = "deploying"
    WORKING = "working"
    CONVERSING = "conversing"
    NEEDS_INFO = "needs_info"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    GOAL_CHANGED = "goal_changed"
    DEAD = "dead"
    TERMINATED = "terminated"


class GoalStatus(models.TextChoices):
    ACTIVE = "active"
    SATISFIED = "satisfied"
    ABANDONED = "abandoned"


class Goal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="goals"
    )
    text = models.TextField()
    context_path = models.CharField(max_length=512)
    plan = models.JSONField(default=list, blank=True)
    status = models.CharField(
        max_length=20, choices=GoalStatus.choices, default=GoalStatus.ACTIVE
    )
    created_at = models.DateTimeField(auto_now_add=True)
    satisfied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.text[:80]


class GoalTrajectory(models.Model):
    goal = models.ForeignKey(Goal, on_delete=models.CASCADE, related_name="trajectory")
    text_snapshot = models.TextField()
    plan_snapshot = models.JSONField(default=list)
    trigger = models.CharField(max_length=30)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["timestamp"]


class Agent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.CharField(max_length=100)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="agents"
    )
    goal = models.ForeignKey(
        Goal, on_delete=models.SET_NULL, null=True, blank=True, related_name="agents"
    )
    runtime = models.CharField(
        max_length=20, choices=[("modal", "Modal"), ("docker", "Docker")]
    )
    sandbox_id = models.CharField(max_length=255, blank=True)
    vnc_url = models.URLField(blank=True)

    status = models.CharField(
        max_length=20, choices=AgentStatus.choices, default=AgentStatus.DEPLOYING
    )
    confidence = models.FloatField(default=0.5)
    sentiment = models.TextField(blank=True)
    summary = models.TextField(blank=True)
    reasoning = models.TextField(blank=True)
    output = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.status})"


class AgentEvent(models.Model):
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=50)
    data = models.JSONField(default=dict)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]


class Case(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    goal_text = models.TextField()
    context_path = models.CharField(max_length=512)
    plan = models.JSONField()
    outcome = models.CharField(max_length=20)
    duration_seconds = models.IntegerField(null=True)
    total_tokens = models.IntegerField(null=True)
    embedding = VectorField(dimensions=1536, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            HnswIndex(
                name="case_embedding_idx",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            )
        ]


class AgentUsage(models.Model):
    agent = models.ForeignKey(
        Agent, on_delete=models.CASCADE, related_name="usage_records"
    )
    input_tokens = models.IntegerField()
    output_tokens = models.IntegerField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]
