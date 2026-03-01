"""Seed development data matching the frontend mock data.

Usage:
    docker compose exec backend uv run python manage.py seed_dev_data

Creates:
    - 1 project (owned by test user 'vahid')
    - 7 agents with varied statuses, modes, attention levels, tags, snapshots
    - ~25 TeamFeedItems covering all types
    - 4 ProjectSecrets
"""

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

User = get_user_model()


def _snapshot(last_text: str, tool_name: str = "", result: dict | None = None) -> dict:
    """Build a latest_snapshot dict matching the adapter's expected structure."""
    content = []
    if last_text:
        content.append({"type": "text", "text": last_text})
    if tool_name:
        content.append({
            "type": "tool_use",
            "id": f"toolu_{tool_name.lower()}",
            "name": tool_name,
            "input": {},
        })

    snap = {}
    if content:
        snap["assistant"] = {
            "type": "assistant",
            "message": {"content": content},
        }
    if result:
        snap["result"] = result
    return snap


class Command(BaseCommand):
    help = "Seed development data matching dashboard mock data"

    def handle(self, *args, **options):
        from agents.models import Agent, AgentStatus, AgentTask, ProjectSecret, TeamFeedItem
        from agents.services.secrets import encrypt_value
        from projects.models import Project

        # Get or create test user
        user, _ = User.objects.get_or_create(
            username="vahid",
            defaults={"email": "veyorokon@gmail.com"},
        )
        if not user.has_usable_password():
            user.set_password("test1234")
            user.save()

        # Get or create project
        project, created = Project.objects.get_or_create(
            name="agentobox",
            owner=user,
        )
        if created:
            self.stdout.write(f"Created project: {project.name}")

        # Clean existing seed data
        Agent.objects.filter(project=project).delete()
        TeamFeedItem.objects.filter(project=project).delete()
        ProjectSecret.objects.filter(project=project).delete()
        AgentTask.objects.filter(project=project).delete()

        # ── Agents ──

        agents_data = [
            {
                "name": "team-lead",
                "status": AgentStatus.RUNNING,
                "attention_level": "none",
                "task": "Coordinating sprint tasks",
                "session_cost_usd": 0.18,
                "model": "claude-opus-4-6",
                "phase": "",
                "instructions": "Orchestrate the team. Break down tasks, delegate to specialists, track progress, resolve blockers.",
                "runtime": "docker",
                "workspace_path": "/workspace/agentobox",
                "tags": ["core"],
                "mode": "plan",
                "latest_snapshot": _snapshot(
                    "Delegated auth fix to backend, waiting on QA...",
                    result={"type": "result", "duration_ms": 725000, "num_turns": 14, "total_cost_usd": 0.18},
                ),
            },
            {
                "name": "backend",
                "status": AgentStatus.RUNNING,
                "attention_level": "none",
                "task": "Editing auth.ts — fixing JWT validation",
                "session_cost_usd": 0.12,
                "model": "claude-opus-4-6",
                "phase": "tool-input",
                "instructions": "Django 6.0 backend: models, services, auth, GraphQL schema. Run tests before committing.",
                "mcp_servers": {"computer-use": {"command": "computer-use"}},
                "runtime": "docker",
                "workspace_path": "/workspace/agentobox",
                "tags": ["backend", "core"],
                "mode": "plan",
                "latest_snapshot": _snapshot(
                    "Applied fix to validateToken()...",
                    tool_name="Edit",
                ),
            },
            {
                "name": "frontend",
                "status": AgentStatus.RUNNING,
                "attention_level": "none",
                "task": "Reading component styles",
                "session_cost_usd": 0.08,
                "model": "claude-sonnet-4-6",
                "phase": "responding",
                "instructions": "Next.js dashboard: components, stores, GraphQL client, Tailwind CSS. Follow design tokens.",
                "mcp_servers": {"playwright": {"command": "npx @playwright/mcp@latest"}, "computer-use": {"command": "computer-use"}},
                "runtime": "docker",
                "workspace_path": "/workspace/agentobox",
                "tags": ["frontend", "core"],
                "mode": "auto",
                "latest_snapshot": _snapshot(
                    "Scanning tailwind classes in Button...",
                    tool_name="Read",
                ),
            },
            {
                "name": "qa",
                "status": AgentStatus.ERROR,
                "attention_level": "permission",
                "task": "npm test failed",
                "session_cost_usd": 0.05,
                "model": "claude-sonnet-4-6",
                "phase": "",
                "instructions": "Run test suites, deploy test agents, Playwright E2E. Report failures with reproduction steps.",
                "mcp_servers": {"playwright": {"command": "npx @playwright/mcp@latest"}},
                "runtime": "docker",
                "workspace_path": "/workspace/agentobox",
                "tags": ["testing", "ci"],
                "mode": "supervised",
                "latest_snapshot": _snapshot(
                    "FAIL src/auth.test.ts\nExpected 200, received 401",
                    tool_name="Bash",
                ),
            },
            {
                "name": "devops",
                "status": AgentStatus.WAITING,
                "attention_level": "plan",
                "task": "Waiting for backend",
                "session_cost_usd": 0.03,
                "model": "claude-haiku-4-5-20251001",
                "phase": "",
                "instructions": "Infrastructure: Docker, CI/CD, Modal config, monitoring. No destructive ops without approval.",
                "mcp_servers": {"computer-use": {"command": "computer-use"}},
                "runtime": "docker",
                "workspace_path": "/workspace/agentobox",
                "tags": ["infra", "ci"],
                "mode": "auto",
                "latest_snapshot": _snapshot(
                    "Standing by...",
                    result={"type": "result", "duration_ms": 300000, "num_turns": 1, "total_cost_usd": 0.03},
                ),
            },
            {
                "name": "docs",
                "status": AgentStatus.STOPPED,
                "attention_level": "review",
                "task": "Completed README update",
                "session_cost_usd": 0.02,
                "model": "claude-haiku-4-5-20251001",
                "phase": "",
                "instructions": "Documentation: API reference, architecture docs, migration guides. Keep examples current.",
                "runtime": "docker",
                "workspace_path": "/workspace/agentobox",
                "tags": ["docs"],
                "mode": "auto",
                "latest_snapshot": _snapshot(
                    "Updated API reference section",
                    result={"type": "result", "duration_ms": 90000, "num_turns": 2, "total_cost_usd": 0.02},
                ),
            },
            {
                "name": "infra",
                "status": AgentStatus.DEPLOYING,
                "attention_level": "none",
                "task": "Provisioning container",
                "session_cost_usd": 0.00,
                "model": "claude-haiku-4-5-20251001",
                "phase": "",
                "instructions": "Provisioning: container orchestration, volume management, network config.",
                "runtime": "docker",
                "workspace_path": "/workspace/agentobox",
                "tags": ["infra"],
                "mode": "supervised",
                "latest_snapshot": _snapshot("Initializing workspace..."),
            },
        ]

        agent_objects = {}
        for data in agents_data:
            agent = Agent.objects.create(project=project, agent_type="claude-code", **data)
            agent_objects[agent.name] = agent
            self.stdout.write(f"  Agent: {agent.name} ({agent.status})")

        # ── Feed Items ──

        feed_items = [
            {"type": "system", "text": "session started · Opus 4.6 · 47 tools · 6 agents"},
            {"type": "user", "text": "Fix the JWT validation bug in auth.ts. The token expiry check is off by one hour.", "target": "backend"},
            {"type": "user", "text": "Run the test suite after backend finishes and report results.", "target": "qa"},
            {"type": "user", "text": "Update the API docs once the fix lands.", "target": "docs"},
            {"type": "status", "agent_name": "backend", "from_value": "idle", "to_value": "running", "agent_record": agent_objects["backend"]},
            {"type": "status", "agent_name": "qa", "from_value": "idle", "to_value": "waiting", "agent_record": agent_objects["qa"]},
            {"type": "status", "agent_name": "docs", "from_value": "idle", "to_value": "running", "agent_record": agent_objects["docs"]},
            {
                "type": "plan",
                "agent_name": "backend",
                "agent_record": agent_objects["backend"],
                "title": "Fix JWT validation and add clock skew tolerance",
                "plan": (
                    "## Context\n\nThe JWT validation middleware rejects tokens within 5s of expiry.\n\n"
                    "## Changes\n\n1. Fix the unit mismatch\n2. Add clock skew tolerance\n3. Structured error logging\n\n"
                    "## Files\n\n- backend/middleware/auth.ts\n- backend/config/auth.ts\n- backend/tests/auth.test.ts"
                ),
                "plan_status": "approved",
            },
            {
                "type": "summary",
                "agent_name": "backend",
                "agent_record": agent_objects["backend"],
                "summary": "Fixed JWT validation — converted Date.now() to seconds, added 30s clock skew tolerance",
                "cost": 0.08,
                "turns": 5,
                "duration": "2m 10s",
            },
            {
                "type": "multi-question",
                "agent_name": "backend",
                "agent_record": agent_objects["backend"],
                "questions": [
                    {"text": "Which token storage strategy?", "options": ["HTTP-only cookies", "In-memory", "Session storage"]},
                    {"text": "Single-session or multiple?", "options": ["Single session", "Multiple (up to 5)", "Unlimited"]},
                ],
            },
            {
                "type": "question",
                "agent_name": "backend",
                "agent_record": agent_objects["backend"],
                "question": "Should I also add refresh token rotation while I'm in auth.ts?",
                "options": ["Yes, add rotation", "No, just the fix", "Create a separate task for it"],
            },
            {"type": "user", "text": "Yes, add rotation. Good catch."},
            {"type": "status", "agent_name": "qa", "from_value": "waiting", "to_value": "running", "agent_record": agent_objects["qa"]},
            {
                "type": "summary",
                "agent_name": "backend",
                "agent_record": agent_objects["backend"],
                "summary": "Added refresh token rotation — tokens rotate on each refresh, old tokens invalidated after 60s grace period.",
                "cost": 0.04,
                "turns": 3,
                "duration": "1m 12s",
            },
            {
                "type": "error",
                "agent_name": "qa",
                "agent_record": agent_objects["qa"],
                "text": "2 assertions failed in auth.test.ts:\n  - Expected 200 on /api/refresh, got 401\n  - Token rotation test expects old format",
            },
            {"type": "status", "agent_name": "qa", "from_value": "running", "to_value": "error", "agent_record": agent_objects["qa"]},
            {
                "type": "agent-message",
                "agent_name": "backend",
                "agent_record": agent_objects["backend"],
                "from_value": "backend",
                "to_value": "qa",
                "text": "auth endpoints updated — refresh rotation uses new token format now, you may need to update fixtures",
            },
            {"type": "user", "text": "@backend the refresh endpoint still rejects — check the middleware order", "target": "backend"},
            {
                "type": "summary",
                "agent_name": "backend",
                "agent_record": agent_objects["backend"],
                "summary": "Fixed middleware ordering — auth middleware now runs after token refresh handler.",
                "cost": 0.04,
                "turns": 3,
                "duration": "1m 00s",
            },
            {"type": "status", "agent_name": "qa", "from_value": "error", "to_value": "running", "agent_record": agent_objects["qa"]},
            {
                "type": "summary",
                "agent_name": "qa",
                "agent_record": agent_objects["qa"],
                "summary": "All 47 tests passing. Auth suite: 12/12 pass. Refresh rotation: 3/3 pass.",
                "cost": 0.05,
                "turns": 5,
                "duration": "2m 10s",
            },
            {
                "type": "agent-message",
                "agent_name": "qa",
                "agent_record": agent_objects["qa"],
                "from_value": "qa",
                "to_value": "devops",
                "text": "fix/jwt-validation is green — 47/47 tests pass, safe to deploy",
            },
            {
                "type": "permission",
                "agent_name": "qa",
                "agent_record": agent_objects["qa"],
                "command": "git push origin fix/jwt-validation",
                "risk": "Pushes to remote branch",
                "perm_status": "pending",
            },
            {
                "type": "plan",
                "agent_name": "devops",
                "agent_record": agent_objects["devops"],
                "title": "Deploy auth fix to staging",
                "plan": (
                    "## Context\n\nThe auth hotfix needs to reach staging.\n\n"
                    "## Steps\n\n1. Build Docker image\n2. Run integration tests\n3. Blue-green deploy\n\n"
                    "## Rollback\n\nAutomatic revert if health checks fail within 120s."
                ),
                "plan_status": "pending",
            },
            {
                "type": "summary",
                "agent_name": "docs",
                "agent_record": agent_objects["docs"],
                "summary": "Updated API reference — added refresh token rotation docs, updated auth flow diagram.",
                "cost": 0.02,
                "turns": 2,
                "duration": "1m 30s",
            },
            {"type": "status", "agent_name": "docs", "from_value": "running", "to_value": "stopped", "agent_record": agent_objects["docs"]},
            {"type": "system", "text": "3 agents completed · 18 turns · $0.23 total"},
        ]

        for item_data in feed_items:
            TeamFeedItem.objects.create(project=project, **item_data)
        self.stdout.write(f"  Feed items: {len(feed_items)}")

        # ── Tasks ──

        tasks_data = [
            {
                "agent": agent_objects["team-lead"],
                "task_id": "mcp_task_001",
                "subject": "Fix JWT validation bug in auth.ts",
                "description": "The token expiry check is off by one hour. Fix the unit mismatch and add clock skew tolerance.",
                "status": "completed",
                "owner": "backend",
                "active_form": "Fixing JWT validation",
                "metadata": {"priority": "high", "sprint": "2026-w09"},
                "blocks": [],
                "blocked_by": [],
            },
            {
                "agent": agent_objects["team-lead"],
                "task_id": "mcp_task_002",
                "subject": "Add refresh token rotation",
                "description": "Implement token rotation on each refresh. Old tokens invalidated after 60s grace period.",
                "status": "completed",
                "owner": "backend",
                "active_form": "Adding refresh token rotation",
                "metadata": {"priority": "medium"},
                "blocks": ["mcp_task_003"],
                "blocked_by": ["mcp_task_001"],
            },
            {
                "agent": agent_objects["team-lead"],
                "task_id": "mcp_task_003",
                "subject": "Run full test suite after auth changes",
                "description": "Verify all 47 tests pass with the new auth flow.",
                "status": "completed",
                "owner": "qa",
                "active_form": "Running test suite",
                "metadata": {},
                "blocks": ["mcp_task_004"],
                "blocked_by": ["mcp_task_002"],
            },
            {
                "agent": agent_objects["team-lead"],
                "task_id": "mcp_task_004",
                "subject": "Deploy auth fix to staging",
                "description": "Build Docker image, run integration tests, blue-green deploy.",
                "status": "pending",
                "owner": "devops",
                "active_form": "Deploying to staging",
                "metadata": {"environment": "staging"},
                "blocks": [],
                "blocked_by": ["mcp_task_003"],
            },
            {
                "agent": agent_objects["team-lead"],
                "task_id": "mcp_task_005",
                "subject": "Update API docs for auth changes",
                "description": "Add refresh token rotation docs, update auth flow diagram.",
                "status": "completed",
                "owner": "docs",
                "active_form": "Updating API docs",
                "metadata": {},
                "blocks": [],
                "blocked_by": [],
            },
        ]

        for task_data in tasks_data:
            AgentTask.objects.create(project=project, **task_data)
        self.stdout.write(f"  Tasks: {len(tasks_data)}")

        # ── Secrets ──

        secrets = [
            ("GITHUB_TOKEN", "ghp_a1b2c3d4e5f6g7h8i9j0"),
            ("ANTHROPIC_API_KEY", "sk-ant-api03-xxxxxxxxxxxx"),
            ("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE"),
            ("OPENAI_API_KEY", "sk-proj-xxxxxxxxxxxxxxxx"),
        ]
        for key, value in secrets:
            ProjectSecret.objects.create(
                project=project,
                key=key,
                encrypted_value=encrypt_value(value),
            )
        self.stdout.write(f"  Secrets: {len(secrets)}")

        self.stdout.write(self.style.SUCCESS(
            f"\nSeeded: {len(agents_data)} agents, {len(feed_items)} feed items, "
            f"{len(tasks_data)} tasks, {len(secrets)} secrets"
        ))
