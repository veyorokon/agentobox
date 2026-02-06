# Agentobox Implementation Guide

Practical build guide. Assumes you've read DESIGN.md for the "why."

---

## Tech Stack

```
Control Plane:     Async Django (ASGI) + Django Channels
API:               Strawberry GraphQL (queries, mutations, subscriptions)
Database:          Postgres + pgvector
ORM:               Django ORM (async, single source of truth)
Compute:           Docker + Modal (Python SDK)
Agent Runtime:     Claude Code (structured output mode)
LLM (AI layer):    LiteLLM
Observability:     structlog + OpenTelemetry
Frontend:          Next.js + React + Zustand + Tailwind
```

Why these choices:
- **Async Django** -- ASGI gives us WebSocket subscriptions, async ORM (4.2+), and async views in one framework with auth + admin + migrations
- **Strawberry GraphQL** -- async-native, type-safe with dataclasses, Django integration via strawberry-django. Subscriptions over WebSocket replace SSE
- **pgvector** -- cosine similarity for casebase retrieval. Django integration via `pgvector-python` (VectorField, CosineDistance, HnswIndex)
- **Modal Python SDK** -- mature, well-documented. The JS SDK's immaturity triggered this rewrite

---

## API Strategy

```
Dashboard  <-->  GraphQL  (queries, mutations, subscriptions)
Agents     --->  REST POST /webhook/event  (simple callback, HMAC-signed)
```

GraphQL handles all dashboard communication. One endpoint, flexible queries, real-time via subscriptions. The webhook stays REST because agents in containers shouldn't need a GraphQL client for a simple event POST.

---

## Project Structure

Each top-level folder is a deployable unit with its own Dockerfile. Docker Compose for local dev mirrors Railway exactly.

```
agentobox/
├── backend/                         # Django control plane
│   ├── Dockerfile
│   ├── manage.py
│   ├── pyproject.toml
│   ├── config/
│   │   ├── __init__.py
│   │   ├── settings.py              # django-environ, database, channels, auth
│   │   ├── urls.py                  # /graphql + /webhook/
│   │   ├── asgi.py                  # Strawberry ASGI + Django Channels
│   │   └── telemetry.py             # structlog + OTEL setup
│   ├── accounts/
│   │   ├── models.py                # User extension (API keys)
│   │   ├── admin.py
│   │   └── graphql/
│   │       ├── types.py
│   │       ├── queries.py           # me, user
│   │       └── mutations.py         # login, register, createApiKey
│   ├── projects/
│   │   ├── models.py                # Project
│   │   ├── admin.py
│   │   └── graphql/
│   │       ├── types.py
│   │       ├── queries.py           # projects, project
│   │       └── mutations.py         # createProject, updateProject, deleteProject
│   ├── agents/                      # Core domain (~80% of code)
│   │   ├── models.py                # Agent, AgentEvent, Goal, GoalTrajectory, Case, AgentUsage
│   │   ├── admin.py
│   │   ├── management/
│   │   │   └── commands/
│   │   │       └── gda_loop.py      # GDA loop management command
│   │   ├── services/
│   │   │   ├── lifecycle.py         # create, kill, recover
│   │   │   ├── provision.py         # workspace setup, CLAUDE.md, hooks
│   │   │   ├── comms.py             # send keys, read output
│   │   │   ├── gda.py               # GDA loop logic
│   │   │   └── casebase.py          # embedding, retrieval, guidance
│   │   ├── runtimes/
│   │   │   ├── base.py              # Runtime protocol (Python Protocol class)
│   │   │   ├── modal.py             # Modal Python SDK
│   │   │   └── docker.py            # docker-py (local dev)
│   │   └── graphql/
│   │       ├── types.py
│   │       ├── queries.py           # agents, agent, goals, cases
│   │       ├── mutations.py         # createAgent, killAgent, sendMessage
│   │       └── subscriptions.py     # agentUpdated, newEvent, goalUpdated
│   ├── webhooks/
│   │   ├── views.py                 # POST /webhook/event (HMAC-signed)
│   │   └── urls.py
│   └── schema.py                    # Root Strawberry schema (combines all apps)
│
├── dashboard/                       # Next.js frontend
│   ├── Dockerfile
│   ├── next.config.mjs
│   ├── package.json
│   ├── schema.graphql               # Exported from backend (committed to repo)
│   ├── app/
│   ├── components/
│   ├── stores/
│   ├── lib/
│   │   ├── graphql/                 # Generated types + operations (from schema.graphql)
│   │   │   ├── client.ts
│   │   │   ├── queries.ts
│   │   │   ├── mutations.ts
│   │   │   └── subscriptions.ts
│   │   └── utils.ts
│   └── types/
│
├── agent/                           # Agent container image (universal desktop)
│   ├── Dockerfile                   # Full desktop: Claude Code + Xvfb + VNC + noVNC + browser
│   ├── entrypoint.sh
│   └── hooks/                       # Claude Code plugin
│       ├── hooks.json
│       ├── session-start.sh         # Register agent, persist env
│       ├── post-tool.sh             # Behavioral heartbeat + deliver inbound
│       └── stop-gate.sh             # Gate premature completion
│
├── docker-compose.yml               # Local dev (mirrors Railway 1:1)
├── modal_app.py                     # Modal app definition (references agent/Dockerfile)
├── .env.example
├── Makefile
└── docs/
    ├── DESIGN.md
    ├── IMPLEMENT.md
    └── CLAUDE-CODE-HOOKS.md
```

**Deployment mapping (local = production):**

| docker-compose service | Railway service | Build context | Start command |
|---|---|---|---|
| `backend` | django | `./backend` | `daphne -b 0.0.0.0 -p $PORT config.asgi:application` |
| `gda` | gda-worker | `./backend` | `python manage.py gda_loop` |
| `dashboard` | dashboard | `./dashboard` | `node server.js` |
| `postgres` | Postgres plugin | -- | auto |
| `redis` | Redis plugin | -- | auto |

Same Dockerfiles, same env vars, same commands. `gda` reuses the backend image with a different entrypoint -- shared ORM, no code duplication.

`modal_app.py` sits at root and references `agent/Dockerfile` for the image. Deployed separately via `modal deploy modal_app.py`.

**Schema generation** (decouples frontend from backend builds):

```makefile
# Makefile
schema:
	docker-compose run backend python manage.py export_schema --out /tmp/schema.graphql
	cp /tmp/schema.graphql dashboard/schema.graphql
```

Commit `schema.graphql` to the repo so the dashboard can build independently.

---

## Data Models

### accounts/models.py

```python
from django.contrib.auth.models import AbstractUser
from django.db import models
import secrets

class User(AbstractUser):
    api_key = models.CharField(max_length=64, unique=True, null=True, blank=True)

    def generate_api_key(self):
        self.api_key = secrets.token_urlsafe(48)
        self.save(update_fields=["api_key"])
        return self.api_key
```

### projects/models.py

```python
import uuid
from django.db import models
from django.conf import settings

class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.CharField(max_length=255)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="projects")
    default_runtime = models.CharField(max_length=20, default="modal", choices=[("modal", "Modal"), ("docker", "Docker")])
    anthropic_api_key = models.CharField(max_length=255, blank=True)  # encrypted at rest
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name
```

### agents/models.py

```python
import uuid
from django.db import models
from pgvector.django import VectorField, HnswIndex

class AgentStatus(models.TextChoices):
    WORKING = "working"
    CONVERSING = "conversing"
    NEEDS_INFO = "needs_info"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    GOAL_CHANGED = "goal_changed"
    DEAD = "dead"                 # set by system, not agent

class GoalStatus(models.TextChoices):
    ACTIVE = "active"
    SATISFIED = "satisfied"
    ABANDONED = "abandoned"


class Goal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="goals")
    text = models.TextField()
    context_path = models.CharField(max_length=512)       # workspace scope
    plan = models.JSONField(default=list, blank=True)      # [{text, status}]
    status = models.CharField(max_length=20, choices=GoalStatus.choices, default=GoalStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    satisfied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class GoalTrajectory(models.Model):
    """Immutable snapshot. Any change to goal = new node."""
    goal = models.ForeignKey(Goal, on_delete=models.CASCADE, related_name="trajectory")
    text_snapshot = models.TextField()
    plan_snapshot = models.JSONField(default=list)
    trigger = models.CharField(max_length=30)  # created, plan_created, goal_evolved, replanned, stalled, satisfied
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["timestamp"]


class Agent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.CharField(max_length=100)
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="agents")
    goal = models.ForeignKey(Goal, on_delete=models.SET_NULL, null=True, blank=True, related_name="agents")
    runtime = models.CharField(max_length=20, choices=[("modal", "Modal"), ("docker", "Docker")])
    sandbox_id = models.CharField(max_length=255, blank=True)
    vnc_url = models.URLField(blank=True)

    # Meta protocol -- latest values from structured output
    status = models.CharField(max_length=20, choices=AgentStatus.choices, default=AgentStatus.WORKING)
    confidence = models.FloatField(default=0.5)
    sentiment = models.TextField(blank=True)
    summary = models.TextField(blank=True)
    reasoning = models.TextField(blank=True)
    output = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["project", "name"], name="unique_agent_per_project")
        ]


class AgentEvent(models.Model):
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=50)
    data = models.JSONField(default=dict)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]


class Case(models.Model):
    """Retained (goal, plan, outcome) pair for casebase retrieval."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    goal_text = models.TextField()
    context_path = models.CharField(max_length=512)
    plan = models.JSONField()                              # completed subtask array
    outcome = models.CharField(max_length=20)              # satisfied | abandoned
    duration_seconds = models.IntegerField(null=True)
    total_tokens = models.IntegerField(null=True)
    embedding = VectorField(dimensions=1536, null=True)    # goal representation vector
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
    """Per-response token tracking. Accumulated from Claude Code response envelope."""
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="usage_records")
    input_tokens = models.IntegerField()
    output_tokens = models.IntegerField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]
```

---

## GraphQL Schema

### Root schema (schema.py)

```python
import strawberry
from strawberry.django.views import AsyncGraphQLView

from accounts.graphql.queries import AccountQuery
from accounts.graphql.mutations import AccountMutation
from projects.graphql.queries import ProjectQuery
from projects.graphql.mutations import ProjectMutation
from agents.graphql.queries import AgentQuery
from agents.graphql.mutations import AgentMutation
from agents.graphql.subscriptions import AgentSubscription

@strawberry.type
class Query(AccountQuery, ProjectQuery, AgentQuery):
    pass

@strawberry.type
class Mutation(AccountMutation, ProjectMutation, AgentMutation):
    pass

@strawberry.type
class Subscription(AgentSubscription):
    pass

schema = strawberry.Schema(query=Query, mutation=Mutation, subscription=Subscription)
```

### Types (agents/graphql/types.py)

```python
import strawberry
import strawberry_django
from strawberry import auto
from agents import models

@strawberry_django.type(models.Goal)
class GoalType:
    id: auto
    text: auto
    context_path: auto
    plan: auto
    status: auto
    created_at: auto
    satisfied_at: auto

@strawberry_django.type(models.Agent)
class AgentType:
    id: auto
    name: auto
    runtime: auto
    sandbox_id: auto
    vnc_url: auto
    status: auto
    confidence: auto
    sentiment: auto
    summary: auto
    reasoning: auto
    output: auto
    created_at: auto
    completed_at: auto
    goal: GoalType | None

@strawberry_django.type(models.AgentEvent)
class AgentEventType:
    id: auto
    event_type: auto
    data: auto
    timestamp: auto

@strawberry_django.type(models.Case)
class CaseType:
    id: auto
    goal_text: auto
    context_path: auto
    plan: auto
    outcome: auto
    duration_seconds: auto
    total_tokens: auto
    created_at: auto
```

### Queries (agents/graphql/queries.py)

```python
import strawberry
from strawberry import ID
from typing import Optional
from agents.graphql.types import AgentType, GoalType, CaseType

@strawberry.type
class AgentQuery:
    @strawberry.field
    async def agents(self, project_id: ID) -> list[AgentType]:
        from agents.models import Agent
        return [a async for a in Agent.objects.filter(project_id=project_id)]

    @strawberry.field
    async def agent(self, project_id: ID, name: str) -> Optional[AgentType]:
        from agents.models import Agent
        return await Agent.objects.filter(project_id=project_id, name=name).afirst()

    @strawberry.field
    async def goals(self, project_id: ID) -> list[GoalType]:
        from agents.models import Goal
        return [g async for g in Goal.objects.filter(project_id=project_id)]

    @strawberry.field
    async def cases(self, project_id: ID, limit: int = 20) -> list[CaseType]:
        from agents.models import Case
        return [c async for c in Case.objects.all()[:limit]]
```

### Mutations (agents/graphql/mutations.py)

```python
import strawberry
from strawberry import ID
from agents.graphql.types import AgentType, GoalType

@strawberry.input
class CreateAgentInput:
    project_id: ID
    name: str
    goal_text: str
    context_path: str
    runtime: str = "modal"

@strawberry.input
class SendMessageInput:
    project_id: ID
    agent_name: str
    message: str

@strawberry.type
class AgentMutation:
    @strawberry.mutation
    async def create_agent(self, input: CreateAgentInput) -> AgentType:
        from agents.services.lifecycle import create_agent
        return await create_agent(
            project_id=input.project_id,
            name=input.name,
            goal_text=input.goal_text,
            context_path=input.context_path,
            runtime=input.runtime,
        )

    @strawberry.mutation
    async def kill_agent(self, project_id: ID, name: str) -> bool:
        from agents.services.lifecycle import kill_agent
        return await kill_agent(project_id, name)

    @strawberry.mutation
    async def send_message(self, input: SendMessageInput) -> bool:
        from agents.services.comms import send_message
        return await send_message(input.project_id, input.agent_name, input.message)
```

### Subscriptions (agents/graphql/subscriptions.py)

```python
import strawberry
from strawberry import ID
from typing import AsyncGenerator
from agents.graphql.types import AgentType, AgentEventType

@strawberry.type
class AgentSubscription:
    @strawberry.subscription
    async def agent_updated(self, project_id: ID) -> AsyncGenerator[AgentType, None]:
        """Subscribe to agent status changes for a project."""
        # Implementation: listen to Django Channels group for project
        # Yield AgentType on every meta protocol update
        ...

    @strawberry.subscription
    async def new_event(self, project_id: ID) -> AsyncGenerator[AgentEventType, None]:
        """Subscribe to new agent events for a project."""
        ...
```

---

## ASGI Configuration

### config/asgi.py

```python
import os
from django.core.asgi import get_asgi_application
from strawberry_django.routers import AuthGraphQLProtocolTypeRouter

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_asgi_app = get_asgi_application()

from schema import schema

application = AuthGraphQLProtocolTypeRouter(
    schema,
    django_application=django_asgi_app,
)
```

### config/urls.py

```python
from django.contrib import admin
from django.urls import path, include
from strawberry.django.views import AsyncGraphQLView
from schema import schema

urlpatterns = [
    path("admin/", admin.site.urls),
    path("graphql", AsyncGraphQLView.as_view(schema=schema)),
    path("webhook/", include("webhooks.urls")),
]
```

---

## Runtime Protocol

```python
# agents/runtimes/base.py
from typing import Protocol
from dataclasses import dataclass

@dataclass
class SandboxInstance:
    id: str
    vnc_url: str

class Runtime(Protocol):
    async def create(self, name: str, env: dict[str, str]) -> SandboxInstance: ...
    async def exec(self, sandbox_id: str, cmd: list[str], user: str = "computeruse") -> str: ...
    async def write_file(self, sandbox_id: str, content: bytes, dest: str) -> None: ...
    async def terminate(self, sandbox_id: str) -> None: ...
    async def list_sandboxes(self) -> list[SandboxInstance]: ...
    async def get_status(self, sandbox_id: str) -> str: ...  # running | dead
```

---

## Webhook Endpoint (REST)

```python
# webhooks/views.py
import hmac
import hashlib
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

@csrf_exempt
@require_POST
async def agent_event(request):
    """Inbound from agent containers. HMAC-signed."""
    signature = request.headers.get("X-Signature")
    if not verify_hmac(request.body, signature):
        return JsonResponse({"error": "invalid signature"}, status=401)

    payload = json.loads(request.body)
    # payload: {agent_name, project_id, status, confidence, sentiment, summary, reasoning, output, usage}

    from agents.services.lifecycle import process_agent_event
    await process_agent_event(payload)

    return JsonResponse({"ok": True})
```

---

## Agent Sandbox Hooks

### hooks/hooks.json

```json
{
  "description": "Agentobox agent hooks",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Evaluate if this task is truly complete. Check the original goal and verify all subtasks are done."
          }
        ]
      }
    ]
  }
}
```

### hooks/session-start.sh

```bash
#!/bin/bash
# Register agent with control plane, persist env vars
AGENT_NAME=$(hostname)
CALLBACK_URL="${ABOX_CALLBACK_URL}/webhook/event"

echo "export AGENT_NAME=${AGENT_NAME}" >> "$CLAUDE_ENV_FILE"
echo "export CALLBACK_URL=${CALLBACK_URL}" >> "$CLAUDE_ENV_FILE"

# Register with control plane
curl -s -X POST "${CALLBACK_URL}" \
  -H "Content-Type: application/json" \
  -H "X-Signature: $(echo -n '{}' | openssl dgst -sha256 -hmac ${WEBHOOK_SECRET} | awk '{print $2}')" \
  -d "{\"agent_name\": \"${AGENT_NAME}\", \"project_id\": \"${PROJECT_ID}\", \"event_type\": \"session_start\"}"
```

### hooks/post-tool.sh

```bash
#!/bin/bash
# Behavioral heartbeat + deliver inbound messages
INPUT=$(cat -)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

# Heartbeat: report tool usage to control plane
curl -s -X POST "${CALLBACK_URL}" \
  -H "Content-Type: application/json" \
  -H "X-Signature: $(sign_payload)" \
  -d "{\"agent_name\": \"${AGENT_NAME}\", \"project_id\": \"${PROJECT_ID}\", \"event_type\": \"tool_use\", \"tool\": \"${TOOL_NAME}\"}"

# Check for inbound messages from control plane
INBOUND=$(curl -s "${ABOX_CALLBACK_URL}/webhook/inbound?agent=${AGENT_NAME}&project=${PROJECT_ID}")

if [ "$(echo "$INBOUND" | jq -r '.has_messages')" = "true" ]; then
  MSG=$(echo "$INBOUND" | jq -r '.message')
  echo "{\"systemMessage\": ${MSG}}"
else
  echo "{}"
fi
```

---

## Key Service: Agent Lifecycle

```python
# agents/services/lifecycle.py
from agents.models import Agent, Goal, GoalTrajectory, AgentEvent, AgentStatus, GoalStatus
from agents.runtimes.base import Runtime
from agents.services.provision import provision_workspace

async def create_agent(project_id, name, goal_text, context_path, runtime_name="modal"):
    """Full agent creation flow."""
    from projects.models import Project

    project = await Project.objects.aget(id=project_id)
    runtime = get_runtime(runtime_name)

    # 1. Create goal
    goal = await Goal.objects.acreate(
        project=project,
        text=goal_text,
        context_path=context_path,
    )

    # 2. Create trajectory node
    await GoalTrajectory.objects.acreate(
        goal=goal,
        text_snapshot=goal_text,
        plan_snapshot=[],
        trigger="created",
    )

    # 3. Create sandbox
    env = build_agent_env(project, goal)
    sandbox = await runtime.create(name, env)

    # 4. Provision workspace (CLAUDE.md, hooks, meta protocol instructions)
    await provision_workspace(runtime, sandbox.id, project, goal)

    # 5. Launch Claude Code in tmux
    from agents.runtimes.tmux import launch_claude_code
    await launch_claude_code(runtime, sandbox.id, goal)

    # 6. Save agent
    agent = await Agent.objects.acreate(
        name=name,
        project=project,
        goal=goal,
        runtime=runtime_name,
        sandbox_id=sandbox.id,
        vnc_url=sandbox.vnc_url,
        status=AgentStatus.WORKING,
    )

    # 7. Emit event
    await AgentEvent.objects.acreate(
        agent=agent,
        event_type="created",
        data={"goal": goal_text, "context": context_path},
    )

    return agent
```

---

## Key Service: GDA Loop

```python
# agents/services/gda.py
import asyncio
from agents.models import Agent, AgentStatus, GoalStatus

async def gda_loop():
    """Main GDA loop. Runs continuously. Reads meta protocol output from DB."""
    while True:
        # skip_locked=True prevents contention with concurrent webhook writes
        active_agents = Agent.objects.select_for_update(skip_locked=True).filter(
            status__in=[AgentStatus.WORKING, AgentStatus.CONVERSING, AgentStatus.NEEDS_INFO, AgentStatus.BLOCKED]
        )

        async for agent in active_agents:
            await evaluate_agent(agent)

        await asyncio.sleep(5)  # poll interval


async def evaluate_agent(agent: Agent):
    """Evaluate a single agent's state and act."""
    runtime = get_runtime(agent.runtime)

    # Check if container is alive
    container_status = await runtime.get_status(agent.sandbox_id)
    if container_status == "dead" and agent.status != AgentStatus.COMPLETED:
        agent.status = AgentStatus.DEAD
        await agent.asave(update_fields=["status"])
        await emit_event(agent, "agent_died")
        return

    # Act on meta protocol status
    match agent.status:
        case AgentStatus.WORKING:
            pass  # normal, monitor

        case AgentStatus.CONVERSING:
            pass  # hands off

        case AgentStatus.NEEDS_INFO:
            await try_help(agent)

        case AgentStatus.BLOCKED:
            await escalate(agent)

        case AgentStatus.COMPLETED:
            await handle_completion(agent)

        case AgentStatus.GOAL_CHANGED:
            await handle_goal_change(agent)
```

---

## Casebase Retrieval

```python
# agents/services/casebase.py
from pgvector.django import CosineDistance
from agents.models import Case

async def find_similar_cases(goal_text: str, context_path: str, limit: int = 3) -> list[Case]:
    """Find similar past cases using embedding similarity."""
    embedding = await get_embedding(goal_text)  # LiteLLM embedding call

    cases = Case.objects.annotate(
        distance=CosineDistance("embedding", embedding)
    ).filter(
        distance__lt=0.5,           # similarity threshold
        outcome="satisfied",         # only successful cases
    ).order_by("distance")[:limit]

    return [c async for c in cases]


async def format_guidance(cases: list[Case]) -> str:
    """Format past cases as guidance for the agent."""
    if not cases:
        return ""

    lines = ["Similar past tasks for reference:"]
    for case in cases:
        lines.append(f"\nGoal: {case.goal_text}")
        for i, step in enumerate(case.plan, 1):
            lines.append(f"  Step [{i}]: {step['text']}")
        if case.duration_seconds:
            lines.append(f"  Completed in {case.duration_seconds // 60} min")

    return "\n".join(lines)
```

---

## Environment Variables

```bash
# Django
SECRET_KEY=
DEBUG=false
DATABASE_URL=postgres://user:pass@host:5432/agentobox
ALLOWED_HOSTS=localhost,agentobox.example.com

# Channels (for GraphQL subscriptions)
REDIS_URL=redis://localhost:6379/0

# Runtime
AGENT_RUNTIME=modal
MODAL_TOKEN_ID=
MODAL_TOKEN_SECRET=

# Agent defaults
ANTHROPIC_API_KEY=
GITHUB_TOKEN=

# Webhook security
WEBHOOK_SECRET=

# Observability
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Callback (must be reachable from Modal/Docker containers)
ABOX_CALLBACK_URL=https://agentobox.example.com
```

---

## Dependencies

### control_plane/pyproject.toml

```toml
[project]
name = "agentobox"
version = "0.1.0"
requires-python = ">=3.12"

dependencies = [
    # Framework
    "django>=5.1",
    "django-environ>=0.12",
    "channels>=4.1",
    "channels-redis>=4.2",
    "daphne>=4.1",

    # GraphQL
    "strawberry-graphql>=0.260",
    "strawberry-graphql-django>=0.50",

    # Database
    "psycopg[binary]>=3.2",
    "pgvector>=0.3",

    # Compute runtimes
    "modal>=0.70",
    "docker>=7.0",

    # LLM
    "litellm>=1.50",

    # Observability
    "structlog>=24.4",
    "opentelemetry-api>=1.27",
    "opentelemetry-sdk>=1.27",
    "opentelemetry-instrumentation-django>=0.48",

    # Auth
    "pyjwt>=2.9",
]
```

---

## Docker Compose (Local Dev)

```yaml
# deploy/docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: agentobox
      POSTGRES_USER: agentobox
      POSTGRES_PASSWORD: agentobox
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  control_plane:
    build: ../control_plane
    command: daphne -b 0.0.0.0 -p 8000 config.asgi:application
    environment:
      DATABASE_URL: postgres://agentobox:agentobox@postgres:5432/agentobox
      REDIS_URL: redis://redis:6379/0
      DEBUG: "true"
    ports:
      - "8000:8000"
    depends_on:
      - postgres
      - redis

volumes:
  pgdata:
```

---

## Build Phases

### Phase 1: Scaffold
- Django project with config, accounts, projects, agents apps
- Models and migrations
- Strawberry schema wired up
- Docker compose running (Postgres + Redis)
- Admin UI for debugging

### Phase 2: Core
- Runtime protocol + Modal implementation
- Agent lifecycle service (create, kill)
- Workspace provisioning (CLAUDE.md, hooks)
- GraphQL queries and mutations
- Webhook endpoint

### Phase 3: GDA
- GDA loop (async task)
- Meta protocol parsing (structured output → DB)
- Escalation ladder
- Casebase retention (goal satisfied → case)
- Casebase retrieval (pgvector similarity)

### Phase 4: Real-time
- GraphQL subscriptions (agent updates, events)
- Dashboard integration (Apollo/urql client)
- Inbound message delivery

### Phase 5: Polish
- Observability (structlog + OTEL)
- Auth hardening (JWT, API keys)
- Usage tracking
- Testing at boundaries

### Phase 6: Deploy
- Railway deployment (Django + Postgres + Redis + Dashboard)
- Modal app deployment (`modal deploy`)
- DNS, SSL, monitoring

---

## Deployment Architecture

Everything on two platforms. No Kubernetes, no Terraform, no Celery.

```
Railway (all long-running infra)
├── django             daphne config.asgi:application
├── gda-loop           python manage.py gda_loop
├── dashboard          Next.js (output: standalone)
├── postgres           pgvector enabled
└── redis              channels pub/sub only

Modal (ephemeral agent compute)
├── agent function     spawn containers on demand
└── volume             ~/projects shared workspace
```

### Why Railway

- **Zero ops**: connect GitHub repo, set env vars, it auto-builds from Dockerfile
- **Managed Postgres with pgvector**: `CREATE EXTENSION vector;` and done
- **Managed Redis**: one click, needed only for Django Channels
- **WebSocket support**: native, no timeout issues. Required for GraphQL subscriptions
- **Public URL**: `*.railway.app` gives Modal containers a stable callback endpoint
- **Multiple services from one repo**: Django + GDA loop + dashboard, different start commands
- **Cost**: ~$20-25/mo (Postgres ~$5, Redis ~$5, Django ~$5-10, Dashboard ~$5)

### Why Not Others

- **Fly.io**: volumes are block storage (ReadWriteOnce) -- can't mount same volume across multiple agent containers. Fine for control plane but doesn't help with shared workspace
- **AWS ECS/Fargate**: overkill. ALB + task definitions + RDS + ElastiCache for one Django app
- **DigitalOcean**: viable (supports pgvector + WebSockets) but more config than Railway
- **Vercel**: could host dashboard there (free tier, purpose-built for Next.js) but keeping everything on Railway is simpler ops. One platform, one bill
- **Self-hosted VPS**: cheapest but you own Postgres backups, Redis uptime, TLS certs, OS patching

### Railway Services

**Service 1: Django Control Plane**
```
Build:    Dockerfile
Start:    daphne -b 0.0.0.0 -p $PORT config.asgi:application
Health:   /graphql (GET returns GraphiQL)
```

**Service 2: GDA Loop Worker**
```
Build:    same Dockerfile
Start:    python manage.py gda_loop
Notes:    same codebase, different entrypoint. Reads Postgres, sends inbound messages.
```

**Service 3: Dashboard**
```
Build:    Dockerfile (Next.js standalone output)
Start:    node server.js
Env:      NEXT_PUBLIC_GRAPHQL_URL=https://django-service.railway.app/graphql
```

**Plugin: Postgres**
```
Image:    pgvector/pgvector:pg17
Setup:    CREATE EXTENSION vector;
```

**Plugin: Redis**
```
Usage:    Django Channels layer only (WebSocket pub/sub)
```

### Modal Agent Runtime

```python
# modal_app.py
import modal

app = modal.App("agentobox")
volume = modal.Volume.from_name("agentobox-workspace", create_if_missing=True)

agent_image = (
    modal.Image.from_registry("ghcr.io/anthropics/claude-code-base:latest")  # or custom image
    .apt_install("git", "tmux", "curl", "jq", "xvfb", "x11vnc", "novnc", "websockify")
    .run_commands("npm install -g @anthropic-ai/claude-code")
)
# Every agent gets full desktop. One image, one UX.

@app.function(
    image=agent_image,
    volumes={"/root/projects": volume},
    timeout=3600,
)
def run_agent(goal_id: str, context_path: str, goal_text: str, callback_url: str):
    """Runs Claude Code in a container with structured output mode."""
    # 1. Write CLAUDE.md + hooks to workspace
    # 2. Launch Claude Code in tmux with --json-schema
    # 3. Agent works, hooks POST back to callback_url
    # 4. On completion, structured output captured
    ...
```

**Invoking from Django:**

```python
# agents/services/lifecycle.py
from modal import Function

async def spawn_modal_agent(goal):
    run_agent = Function.lookup("agentobox", "run_agent")
    run_agent.spawn(
        goal_id=str(goal.id),
        context_path=goal.context_path,
        goal_text=goal.text,
        callback_url=settings.ABOX_CALLBACK_URL,
    )
```

`Function.spawn()` is fire-and-forget. No Celery, no task queue. Modal handles the container lifecycle.

### The Flow

```
1. User → Dashboard (Railway) → GraphQL mutation: createAgent
2. Django → modal.Function.spawn() → Modal boots container
3. Modal container mounts volume, runs Claude Code
4. Agent works → structured output on every response
5. Hooks POST to Railway callback URL → Django processes webhook
6. Django updates Postgres → broadcasts via Channels → dashboard subscription fires
7. GDA loop worker reads Postgres → evaluates agent state → sends inbound if needed
8. Agent completes → case retained → container terminated
```

### Environment Variables (Railway)

```bash
# Django service
SECRET_KEY=
DATABASE_URL=          # auto-injected by Railway Postgres plugin
REDIS_URL=             # auto-injected by Railway Redis plugin
ALLOWED_HOSTS=*.railway.app
ABOX_CALLBACK_URL=https://django-service.railway.app

# Modal
MODAL_TOKEN_ID=
MODAL_TOKEN_SECRET=

# Agent defaults
ANTHROPIC_API_KEY=
GITHUB_TOKEN=

# Security
WEBHOOK_SECRET=

# Observability
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=
```

Railway auto-injects `DATABASE_URL` and `REDIS_URL` when you attach the plugins. No manual connection string management.
