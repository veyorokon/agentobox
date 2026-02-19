"""
Seed the database with realistic demo data for the v2 feed.

Creates 1 Project + 4 Agents + Messages/Events/SessionResults covering every
FeedItemKind. Mirrors the mock scenario: 45-minute sprint with auth fix,
card redesign, QA testing.

Produces ~56 feed items + 11 timeline tasks to match the mock spec exactly.

Idempotent: deletes existing "Demo Sprint" project before re-creating.

Usage:
    docker compose exec backend uv run python manage.py seed_demo_feed
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from agents.models import Agent, AgentEvent, Message, SessionResult
from projects.models import Project

User = get_user_model()

PROJECT_NAME = "Demo Sprint"
TEAM_NAME = "dev"


def _mins_ago(base, minutes: float):
    """Return a datetime `minutes` before `base`."""
    return base - timedelta(minutes=minutes)


def _msg(
    agent,
    role: str,
    parts: list,
    mins_ago: float,
    base,
    *,
    turn_number: int = 0,
    session_id: str = "",
    stop_reason: str = "",
    message_id: str = "",
):
    """Helper to build a Message row.

    Stores desired timestamp as `_desired_ts` since auto_now_add
    ignores the created_at value during bulk_create.
    """
    msg = Message(
        agent=agent,
        message_id=message_id or str(uuid.uuid4()),
        session_id=session_id or agent.session_id,
        role=role,
        parts=parts,
        turn_number=turn_number,
        stop_reason=stop_reason,
    )
    msg._desired_ts = _mins_ago(base, mins_ago)
    return msg


def _fix_timestamps(model_class, created_objects):
    """Fix created_at timestamps after bulk_create.

    auto_now_add ignores the values we set, so we fix them
    post-creation via queryset.update() which bypasses auto_now_add.
    """
    for obj in created_objects:
        if hasattr(obj, '_desired_ts'):
            model_class.objects.filter(pk=obj.pk).update(created_at=obj._desired_ts)


class Command(BaseCommand):
    help = "Seed database with demo feed data for v2 dashboard"

    def handle(self, *args, **options):
        now = timezone.now()

        # ── Idempotent cleanup ──
        Project.objects.filter(name=PROJECT_NAME).delete()

        # ── Owner (use first superuser or first user) ──
        owner = User.objects.filter(is_superuser=True).first()
        if not owner:
            owner = User.objects.first()
        if not owner:
            self.stderr.write("No users exist. Run createsuperuser first.")
            return

        # ── Project ──
        project = Project.objects.create(
            name=PROJECT_NAME,
            owner=owner,
        )
        # Delete auto-created team-lead agent from post_save signal
        Agent.objects.filter(project=project).delete()
        self.stdout.write(f"Created project: {project.id}")

        # ── Agents ──
        agents = {}
        agent_defs = [
            ("lead", "lead", "claude-opus-4-6", 45),
            ("backend", "worker", "claude-sonnet-4-5-20250929", 43),
            ("frontend", "worker", "claude-sonnet-4-5-20250929", 42),
            ("qa", "worker", "claude-sonnet-4-5-20250929", 20),
        ]
        for name, role, model, created_mins in agent_defs:
            agent = Agent.objects.create(
                name=name,
                project=project,
                runtime="docker",
                role=role,
                model=model,
                status="running" if name != "qa" else "idle",
                team_name=TEAM_NAME,
                session_id=str(uuid.uuid4()),
                workspace_path="/workspace",
                cwd="/workspace",
            )
            # Fix created_at (auto_now_add ignores the value we set)
            Agent.objects.filter(pk=agent.pk).update(created_at=_mins_ago(now, created_mins))
            agents[name] = agent

        self.stdout.write(f"Created {len(agents)} agents")

        # ── Messages + Events ──
        messages = []
        events = []

        lead = agents["lead"]
        backend = agents["backend"]
        frontend = agents["frontend"]
        qa = agents["qa"]

        def _evt(agent, event_type, mins, data=None, summary=""):
            evt = AgentEvent(agent=agent, event_type=event_type, data=data or {}, summary=summary)
            evt._desired_ts = _mins_ago(now, mins)
            return evt

        # ── Pre-generate timeline task tool_use IDs ──
        # These link TaskCreate → TaskUpdate via tool_use_id
        tt = {f"tt-{i}": str(uuid.uuid4()) for i in range(1, 12)}

        def _task_create(agent, mins, tt_key, subject, active_form, turn):
            """Add a TaskCreate assistant+user message pair.

            Uses mins - 0.01 so task-start dividers appear after same-timestamp
            events/messages in the feed (feed_transform sorts stable by timestamp,
            and processes messages before events).
            """
            tu_id = tt[tt_key]
            adj = mins - 0.01
            messages.append(_msg(agent, "assistant", [
                {"type": "tool_use", "id": tu_id, "name": "TaskCreate", "input": {
                    "subject": subject, "description": "", "activeForm": active_form,
                }},
            ], adj, now, turn_number=turn, stop_reason="tool_use"))
            messages.append(_msg(agent, "user", [
                {"type": "tool_result", "tool_use_id": tu_id, "content": "Task created", "is_error": False},
            ], adj, now, turn_number=turn))

        def _task_complete(agent, mins, tt_key, turn):
            """Add a TaskUpdate(completed) assistant+user message pair.

            Uses mins - 0.01 so task-end dividers appear after same-timestamp
            events/messages in the feed.
            """
            tu_upd = str(uuid.uuid4())
            adj = mins - 0.01
            messages.append(_msg(agent, "assistant", [
                {"type": "tool_use", "id": tu_upd, "name": "TaskUpdate", "input": {
                    "taskId": tt[tt_key], "status": "completed",
                }},
            ], adj, now, turn_number=turn, stop_reason="tool_use"))
            messages.append(_msg(agent, "user", [
                {"type": "tool_result", "tool_use_id": tu_upd, "content": "Task updated", "is_error": False},
            ], adj, now, turn_number=turn))

        # ════════════════════════════════════════════════════════
        # 45 min ago: Session start
        # ════════════════════════════════════════════════════════
        events.append(_evt(lead, "system", 45, summary="Session started"))
        events.append(_evt(lead, "status", 45, {"from": "deploying", "to": "running"}, "Agent deployed"))
        _task_create(lead, 45, "tt-1", "Coordinate sprint kickoff", "Coordinating", turn=100)

        # ════════════════════════════════════════════════════════
        # 43 min ago: Backend deploys
        # ════════════════════════════════════════════════════════
        events.append(_evt(backend, "status", 43, {"from": "deploying", "to": "running"}))
        _task_create(backend, 43, "tt-5", "Fix auth token race condition", "Fixing auth", turn=100)

        # ════════════════════════════════════════════════════════
        # 42 min ago: Frontend deploys + Lead delegates
        # ════════════════════════════════════════════════════════
        events.append(_evt(frontend, "status", 42.01, {"from": "deploying", "to": "running"}))
        _task_create(frontend, 42, "tt-8", "Redesign agent card component", "Redesigning card", turn=100)

        messages.append(_msg(lead, "assistant", [
            {"type": "text", "text": "I'll coordinate this sprint. Backend: fix the auth token refresh bug in services/auth.ts. Frontend: redesign the agent card component with the new color system. QA will join after initial fixes land."},
        ], 42, now, turn_number=1, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 40 min ago: User sends clarification
        # ════════════════════════════════════════════════════════
        messages.append(_msg(backend, "user", [
            {"type": "text", "text": "The token refresh issue is in the middleware, not auth.ts. Check middleware/auth-guard.ts first."},
        ], 40, now, turn_number=2))

        # ════════════════════════════════════════════════════════
        # 39 min ago: Backend acknowledges
        # ════════════════════════════════════════════════════════
        messages.append(_msg(backend, "assistant", [
            {"type": "text", "text": "Got it. I'll look at the middleware first."},
        ], 39, now, turn_number=3, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 38 min ago: Backend reads files (ACTIVITY — Read + Read + Grep)
        # ════════════════════════════════════════════════════════
        tu_read1 = str(uuid.uuid4())
        tu_read2 = str(uuid.uuid4())
        tu_grep1 = str(uuid.uuid4())
        messages.append(_msg(backend, "assistant", [
            {"type": "tool_use", "id": tu_read1, "name": "Read", "input": {"file_path": "middleware/auth-guard.ts"}},
            {"type": "tool_use", "id": tu_read2, "name": "Read", "input": {"file_path": "services/auth.ts"}},
            {"type": "tool_use", "id": tu_grep1, "name": "Grep", "input": {"pattern": "refreshToken"}},
        ], 38, now, turn_number=4, stop_reason="tool_use"))
        messages.append(_msg(backend, "user", [
            {"type": "tool_result", "tool_use_id": tu_read1, "content": "import { NextRequest, NextResponse } from 'next/server';\nimport { tokenCache } from '../services/token-cache';\nimport { refreshAccessToken } from '../services/auth';\n\nexport async function authGuard(req: NextRequest) {\n  const token = req.headers.get('Authorization')?.replace('Bearer ', '');\n  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });\n\n  const cached = tokenCache.get(token);\n  if (cached && !cached.expired) return NextResponse.next();\n\n  // BUG: No mutex — concurrent requests both trigger refresh\n  const newToken = await refreshAccessToken(token);", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_read2, "content": "export async function refreshAccessToken(oldToken: string): Promise<string> {\n  const res = await fetch('/api/auth/refresh', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ token: oldToken }),\n  });\n  if (!res.ok) throw new Error('Token refresh failed');\n  const { accessToken } = await res.json();\n  return accessToken;\n}", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_grep1, "content": "middleware/auth-guard.ts:12:  const newToken = await refreshAccessToken(token);\nservices/auth.ts:1:export async function refreshAccessToken(oldToken: string)\nservices/token-cache.ts:8:  refreshToken(key: string): void {\ntests/auth-guard.test.ts:23:  it('should refresh token once', async () => {", "is_error": False},
        ], 38, now, turn_number=4))

        # ════════════════════════════════════════════════════════
        # 37 min ago: Frontend plans card redesign (PLAN — content)
        # + Lead completes tt-1 (Coordinate sprint kickoff)
        # ════════════════════════════════════════════════════════
        tu_plan_enter = str(uuid.uuid4())
        messages.append(_msg(frontend, "assistant", [
            {"type": "text", "text": "# Redesign agent card with new color system\n\n1. Read existing agent-card.tsx and agent-colors.ts\n2. Replace hardcoded colors with identity color system\n3. Add augmented-ui tl-clip br-clip borders\n4. Add status dot with glow animation\n5. Run build check"},
            {"type": "tool_use", "id": tu_plan_enter, "name": "EnterPlanMode", "input": {}},
        ], 37, now, turn_number=1, stop_reason="tool_use"))
        messages.append(_msg(frontend, "user", [
            {"type": "tool_result", "tool_use_id": tu_plan_enter, "content": "", "is_error": False},
        ], 37, now, turn_number=1))

        _task_complete(lead, 37, "tt-1", turn=101)

        # ════════════════════════════════════════════════════════
        # 36.5 min ago: Plan approved (PLAN — approved)
        # ════════════════════════════════════════════════════════
        tu_plan_exit = str(uuid.uuid4())
        messages.append(_msg(frontend, "assistant", [
            {"type": "text", "text": "Redesign agent card with new color system"},
            {"type": "tool_use", "id": tu_plan_exit, "name": "ExitPlanMode", "input": {}},
        ], 36.5, now, turn_number=2, stop_reason="tool_use"))
        messages.append(_msg(frontend, "user", [
            {"type": "tool_result", "tool_use_id": tu_plan_exit, "content": "", "is_error": False},
        ], 36.5, now, turn_number=2))

        # ════════════════════════════════════════════════════════
        # 36 min ago: Frontend starts component work (AGENT_TEXT)
        # ════════════════════════════════════════════════════════
        messages.append(_msg(frontend, "assistant", [
            {"type": "text", "text": "Starting on the agent card redesign. Reading the existing component and color system."},
        ], 36, now, turn_number=3, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 35 min ago: Frontend reads existing files (ACTIVITY — Read + Read)
        # ════════════════════════════════════════════════════════
        tu_fread1 = str(uuid.uuid4())
        tu_fread2 = str(uuid.uuid4())
        messages.append(_msg(frontend, "assistant", [
            {"type": "tool_use", "id": tu_fread1, "name": "Read", "input": {"file_path": "components/agent-card.tsx"}},
            {"type": "tool_use", "id": tu_fread2, "name": "Read", "input": {"file_path": "lib/agent-colors.ts"}},
        ], 35, now, turn_number=4, stop_reason="tool_use"))
        messages.append(_msg(frontend, "user", [
            {"type": "tool_result", "tool_use_id": tu_fread1, "content": "import { Agent } from '@/types';\n\nexport function AgentCard({ agent }: { agent: Agent }) {\n  return (\n    <div className=\"border border-gray-700 rounded-lg p-4\">\n      <h3 className=\"text-white font-bold\">{agent.name}</h3>\n      <span className=\"text-gray-400\">{agent.status}</span>\n    </div>\n  );\n}", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_fread2, "content": "const PALETTE = [\n  'var(--agent-color-0)',\n  'var(--agent-color-1)',\n  'var(--agent-color-2)',\n] as const;", "is_error": False},
        ], 35, now, turn_number=4))

        # ════════════════════════════════════════════════════════
        # 34 min ago: Backend explains bug (AGENT_TEXT)
        # ════════════════════════════════════════════════════════
        messages.append(_msg(backend, "assistant", [
            {"type": "text", "text": "Found the issue. The refresh token middleware catches expired tokens but the retry logic has a race condition. Two concurrent requests both trigger a refresh, and the second one fails because the first already invalidated the old token."},
        ], 34, now, turn_number=5, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 33 min ago: Backend edits files (ACTIVITY — Edit + Edit)
        # ════════════════════════════════════════════════════════
        tu_edit1 = str(uuid.uuid4())
        tu_edit2 = str(uuid.uuid4())
        messages.append(_msg(backend, "assistant", [
            {"type": "tool_use", "id": tu_edit1, "name": "Edit", "input": {
                "file_path": "middleware/auth-guard.ts",
                "old_string": "  // BUG: No mutex — concurrent requests both trigger refresh\n  const newToken = await refreshAccessToken(token);",
                "new_string": "  // Use mutex to prevent concurrent refresh race condition\n  const newToken = await tokenCache.refreshWithLock(token, async () => {\n    return refreshAccessToken(token);\n  });",
            }},
            {"type": "tool_use", "id": tu_edit2, "name": "Edit", "input": {
                "file_path": "services/token-cache.ts",
                "old_string": "class TokenCache {",
                "new_string": "class TokenCache {\n  private locks = new Map<string, Promise<string>>();\n\n  async refreshWithLock(key: string, fn: () => Promise<string>): Promise<string> {\n    const existing = this.locks.get(key);\n    if (existing) return existing;\n    const promise = fn().finally(() => this.locks.delete(key));\n    this.locks.set(key, promise);\n    return promise;\n  }",
            }},
        ], 33, now, turn_number=6, stop_reason="tool_use"))
        messages.append(_msg(backend, "user", [
            {"type": "tool_result", "tool_use_id": tu_edit1, "content": "Applied edit to middleware/auth-guard.ts", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_edit2, "content": "Applied edit to services/token-cache.ts", "is_error": False},
        ], 33, now, turn_number=6))

        # ════════════════════════════════════════════════════════
        # 32 min ago: Backend saves CLAUDE.md (MEMORY)
        # ════════════════════════════════════════════════════════
        tu_memory = str(uuid.uuid4())
        messages.append(_msg(backend, "assistant", [
            {"type": "tool_use", "id": tu_memory, "name": "Edit", "input": {
                "file_path": "/workspace/CLAUDE.md",
                "old_string": "# Known Issues",
                "new_string": "# Known Issues\n\n- Auth middleware has race condition on concurrent token refresh — use mutex pattern",
            }},
        ], 32, now, turn_number=7, stop_reason="tool_use"))
        messages.append(_msg(backend, "user", [
            {"type": "tool_result", "tool_use_id": tu_memory, "content": "Applied edit to CLAUDE.md", "is_error": False},
        ], 32, now, turn_number=7))

        # ════════════════════════════════════════════════════════
        # 30 min ago: Frontend builds component (ACTIVITY — Edit + Write + Edit)
        # ════════════════════════════════════════════════════════
        tu_fedit1 = str(uuid.uuid4())
        tu_fwrite1 = str(uuid.uuid4())
        tu_fedit2 = str(uuid.uuid4())
        messages.append(_msg(frontend, "assistant", [
            {"type": "tool_use", "id": tu_fedit1, "name": "Edit", "input": {
                "file_path": "components/agent-card.tsx",
                "old_string": "    <div className=\"border border-gray-700 rounded-lg p-4\">",
                "new_string": "    <div\n      data-augmented-ui=\"tl-clip br-clip border\"\n      style={{ '--aug-border-bg': getAgentColor(agent.name, agent.role) }}\n    >",
            }},
            {"type": "tool_use", "id": tu_fwrite1, "name": "Write", "input": {
                "file_path": "components/agent-status-dot.tsx",
                "content": "import type { AgentStatus } from '@/types';\n\ninterface Props { status: AgentStatus; color: string }\n\nexport function AgentStatusDot({ status, color }: Props) {\n  const isActive = status === 'running';\n  return (\n    <span\n      className=\"w-2 h-2 rounded-full\"\n      style={{\n        background: isActive ? color : 'var(--muted-foreground)',\n        boxShadow: isActive ? `0 0 6px ${color}` : 'none',\n      }}\n    />\n  );\n}",
            }},
            {"type": "tool_use", "id": tu_fedit2, "name": "Edit", "input": {
                "file_path": "app/globals.css",
                "old_string": "@keyframes border-pulse {",
                "new_string": "/* Agent card status dot glow */\n@keyframes status-glow {\n  0%, 100% { box-shadow: 0 0 4px currentColor; }\n  50% { box-shadow: 0 0 8px currentColor, 0 0 12px currentColor; }\n}\n@keyframes border-pulse {",
            }},
        ], 30, now, turn_number=5, stop_reason="tool_use"))
        messages.append(_msg(frontend, "user", [
            {"type": "tool_result", "tool_use_id": tu_fedit1, "content": "Applied edit to components/agent-card.tsx", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_fwrite1, "content": "Created components/agent-status-dot.tsx", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_fedit2, "content": "Applied edit to app/globals.css", "is_error": False},
        ], 30, now, turn_number=5))

        # ════════════════════════════════════════════════════════
        # 28 min ago: Backend runs tests — FAILURE (ACTIVITY with error Bash)
        # ════════════════════════════════════════════════════════
        tu_bash_fail = str(uuid.uuid4())
        messages.append(_msg(backend, "assistant", [
            {"type": "tool_use", "id": tu_bash_fail, "name": "Bash", "input": {"command": "npm test -- --grep auth"}},
        ], 28, now, turn_number=8, stop_reason="tool_use"))
        messages.append(_msg(backend, "user", [
            {"type": "tool_result", "tool_use_id": tu_bash_fail, "content": "> workspace@1.0.0 test\n> jest --grep auth\n\n FAIL tests/auth-guard.test.ts\n  Token refresh race condition\n    \u2713 should validate token (12ms)\n    \u2713 should reject expired token (8ms)\n    \u2717 should refresh token once (45ms)\n    \u2713 should cache refreshed token (15ms)\n\n  1 of 4 tests failed", "is_error": True},
        ], 28, now, turn_number=8))

        # ════════════════════════════════════════════════════════
        # 27 min ago: ERROR event — test failure
        # ════════════════════════════════════════════════════════
        events.append(_evt(backend, "error", 27, {
            "text": "FAIL tests/auth-guard.test.ts\n  Token refresh race condition\n    Expected: token to be refreshed once\n    Received: refreshToken called 2 times\n\n  1 of 4 tests failed",
        }, "Test failure: token refresh race condition"))

        # ════════════════════════════════════════════════════════
        # 26 min ago: Backend explains test failure (AGENT_TEXT — separate message)
        # ════════════════════════════════════════════════════════
        messages.append(_msg(backend, "assistant", [
            {"type": "text", "text": "Test failure caught the exact race condition. Adding a mutex lock around the token refresh."},
        ], 26, now, turn_number=9, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 25 min ago: Backend fixes and retests (ACTIVITY — Edit + Bash success)
        # ════════════════════════════════════════════════════════
        tu_fix = str(uuid.uuid4())
        tu_bash_pass = str(uuid.uuid4())
        messages.append(_msg(backend, "assistant", [
            {"type": "tool_use", "id": tu_fix, "name": "Edit", "input": {
                "file_path": "middleware/auth-guard.ts",
                "old_string": "  const newToken = await tokenCache.refreshWithLock(token, async () => {\n    return refreshAccessToken(token);\n  });",
                "new_string": "  const newToken = await tokenCache.refreshWithLock(token, () =>\n    refreshAccessToken(token)\n  );\n  if (!newToken) return NextResponse.json({ error: \"Refresh failed\" }, { status: 401 });",
            }},
            {"type": "tool_use", "id": tu_bash_pass, "name": "Bash", "input": {"command": "npm test -- --grep auth"}},
        ], 25, now, turn_number=10, stop_reason="tool_use"))
        messages.append(_msg(backend, "user", [
            {"type": "tool_result", "tool_use_id": tu_fix, "content": "Applied edit to middleware/auth-guard.ts", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_bash_pass, "content": "> workspace@1.0.0 test\n> jest --grep auth\n\n PASS tests/auth-guard.test.ts\n  Token refresh race condition\n    \u2713 should validate token (11ms)\n    \u2713 should reject expired token (7ms)\n    \u2713 should refresh token once (42ms)\n    \u2713 should cache refreshed token (14ms)\n\n  4 of 4 tests passed", "is_error": False},
        ], 25, now, turn_number=10))

        # ════════════════════════════════════════════════════════
        # 24 min ago: Backend TASK event + timeline task end (tt-5)
        # ════════════════════════════════════════════════════════
        events.append(_evt(backend, "task", 24, {
            "summary": "Auth fix verified — all 4 tests passing",
        }, "Auth fix verified — all 4 tests passing"))
        _task_complete(backend, 24, "tt-5", turn=101)

        # ════════════════════════════════════════════════════════
        # 22 min ago: Frontend finishes first pass (AGENT_TEXT)
        # ════════════════════════════════════════════════════════
        messages.append(_msg(frontend, "assistant", [
            {"type": "text", "text": "Agent card redesign complete. Added identity color borders, status dot with glow, and augmented-ui clip corners. Ready for review."},
        ], 22, now, turn_number=6, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 21 min ago: Frontend final edits + build (ACTIVITY — Edit + Bash)
        # + Frontend TASK event
        # ════════════════════════════════════════════════════════
        tu_fimport = str(uuid.uuid4())
        tu_fbuild = str(uuid.uuid4())
        messages.append(_msg(frontend, "assistant", [
            {"type": "tool_use", "id": tu_fimport, "name": "Edit", "input": {
                "file_path": "components/agent-card.tsx",
                "old_string": "import { Agent } from '@/types';",
                "new_string": "import { Agent } from '@/types';\nimport { getAgentColor } from '@/lib/agent-colors';\nimport { AgentStatusDot } from './agent-status-dot';",
            }},
            {"type": "tool_use", "id": tu_fbuild, "name": "Bash", "input": {"command": "npx next build"}},
        ], 21, now, turn_number=7, stop_reason="tool_use"))
        messages.append(_msg(frontend, "user", [
            {"type": "tool_result", "tool_use_id": tu_fimport, "content": "Applied edit to components/agent-card.tsx", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_fbuild, "content": "   Creating an optimized production build...\n   Compiled successfully.\n\n   Route (app)              Size     First Load JS\n   \u250c \u25cb /                     5.2 kB       89.4 kB\n   \u2514 \u25cb /v2                   12.1 kB      96.3 kB\n   \u2713 Build completed in 8.2s", "is_error": False},
        ], 21, now, turn_number=7))

        events.append(_evt(frontend, "task", 21, {
            "summary": "Agent card redesign — build passes",
        }, "Agent card redesign — build passes"))

        # ════════════════════════════════════════════════════════
        # 20 min ago: QA deploys + timeline tasks start
        # Frontend tt-8 ends, QA tt-11 starts, Backend tt-6 starts
        # ════════════════════════════════════════════════════════
        events.append(_evt(qa, "status", 20, {"from": "deploying", "to": "running"}))
        # Order matches mock's timeline iteration: tt-6 start, tt-8 end, tt-11 start
        _task_create(backend, 20, "tt-6", "Optimize query performance", "Optimizing", turn=102)
        _task_complete(frontend, 20, "tt-8", turn=101)
        _task_create(qa, 20, "tt-11", "Run full test suite & integration tests", "Running tests", turn=100)

        # ════════════════════════════════════════════════════════
        # 19 min ago: Lead directs QA + tt-2 starts
        # ════════════════════════════════════════════════════════
        _task_create(lead, 19, "tt-2", "Review backend auth fix", "Reviewing", turn=102)
        messages.append(_msg(lead, "assistant", [
            {"type": "text", "text": "QA is now online. Please run the full test suite and check the auth middleware changes + the new agent card component."},
        ], 19, now, turn_number=2, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 18 min ago: Lead reviews backend work (AGENT_TEXT)
        # ════════════════════════════════════════════════════════
        messages.append(_msg(lead, "assistant", [
            {"type": "text", "text": "Backend's auth fix looks solid. The mutex approach prevents the race condition without blocking unrelated requests. Approved."},
        ], 18, now, turn_number=3, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 17 min ago: Lead TASK event + tt-2 ends
        # ════════════════════════════════════════════════════════
        events.append(_evt(lead, "task", 17, {
            "summary": "Reviewed backend auth fix",
        }, "Reviewed backend auth fix"))
        _task_complete(lead, 17, "tt-2", turn=103)

        # ════════════════════════════════════════════════════════
        # 16 min ago: QA runs tests (ACTIVITY — Bash + Read)
        # ════════════════════════════════════════════════════════
        tu_qa_bash = str(uuid.uuid4())
        tu_qa_read = str(uuid.uuid4())
        messages.append(_msg(qa, "assistant", [
            {"type": "tool_use", "id": tu_qa_bash, "name": "Bash", "input": {"command": "npm test"}},
            {"type": "tool_use", "id": tu_qa_read, "name": "Read", "input": {"file_path": "tests/auth-guard.test.ts"}},
        ], 16, now, turn_number=1, stop_reason="tool_use"))
        messages.append(_msg(qa, "user", [
            {"type": "tool_result", "tool_use_id": tu_qa_bash, "content": "> workspace@1.0.0 test\n> jest\n\n PASS tests/auth-guard.test.ts (4 tests)\n PASS tests/token-cache.test.ts (6 tests)\n PASS tests/agent-card.test.tsx (8 tests)\n PASS tests/api/endpoints.test.ts (29 tests)\n\nTest Suites: 4 passed, 4 total\nTests:       47 passed, 47 total\nTime:        3.21s", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_qa_read, "content": "import { authGuard } from '../middleware/auth-guard';\nimport { tokenCache } from '../services/token-cache';\n\ndescribe('Token refresh race condition', () => {\n  it('should validate token', async () => {\n    const req = mockRequest({ token: 'valid-token' });\n    const res = await authGuard(req);\n    expect(res.status).toBe(200);\n  });\n\n  it('should reject expired token', async () => {\n    const req = mockRequest({ token: 'expired', noRefresh: true });\n    const res = await authGuard(req);\n    expect(res.status).toBe(401);\n  });", "is_error": False},
        ], 16, now, turn_number=1))

        # ════════════════════════════════════════════════════════
        # 15 min ago: QA reports unit test results (AGENT_TEXT)
        # + Lead tt-3 starts
        # ════════════════════════════════════════════════════════
        _task_create(lead, 15, "tt-3", "Coordinate QA testing", "Coordinating QA", turn=104)
        messages.append(_msg(qa, "assistant", [
            {"type": "text", "text": "Unit tests all passing (47/47). Starting Playwright integration tests for the auth flow."},
        ], 15, now, turn_number=2, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 14 min ago: QA runs Playwright (ACTIVITY — Bash)
        # ════════════════════════════════════════════════════════
        tu_pw = str(uuid.uuid4())
        messages.append(_msg(qa, "assistant", [
            {"type": "tool_use", "id": tu_pw, "name": "Bash", "input": {"command": "npx playwright test auth"}},
        ], 14, now, turn_number=3, stop_reason="tool_use"))
        messages.append(_msg(qa, "user", [
            {"type": "tool_result", "tool_use_id": tu_pw, "content": "Running 6 tests using 2 workers\n\n  \u2713 auth-flow.spec.ts:5 login with valid credentials (1.2s)\n  \u2713 auth-flow.spec.ts:15 refresh token on expiry (2.1s)\n  \u2713 auth-flow.spec.ts:28 concurrent requests share refresh (1.8s)\n  \u2713 auth-flow.spec.ts:42 logout clears cache (0.9s)\n  \u2713 auth-flow.spec.ts:51 invalid token redirect (1.1s)\n  \u2713 auth-flow.spec.ts:62 token persistence across tabs (2.4s)\n\n  6 passed (9.5s)", "is_error": False},
        ], 14, now, turn_number=3))

        # ════════════════════════════════════════════════════════
        # 13 min ago: Backend tt-6 ends (Optimize query performance)
        # ════════════════════════════════════════════════════════
        _task_complete(backend, 13, "tt-6", turn=103)

        # ════════════════════════════════════════════════════════
        # 11 min ago: QA integration results (AGENT_TEXT)
        # + Lead tt-3 ends
        # ════════════════════════════════════════════════════════
        messages.append(_msg(qa, "assistant", [
            {"type": "text", "text": "All integration tests passing. Auth token refresh works correctly under concurrent load. No visual regressions on the new agent card."},
        ], 11, now, turn_number=4, stop_reason="end_turn"))
        _task_complete(lead, 11, "tt-3", turn=105)

        # ════════════════════════════════════════════════════════
        # 10 min ago: QA TASK event + QA goes idle + timeline ends
        # QA tt-11 ends, Backend tt-7 starts
        # ════════════════════════════════════════════════════════
        events.append(_evt(qa, "task", 10, {
            "summary": "QA sign-off — all tests green",
        }, "QA sign-off — all tests green"))
        events.append(_evt(qa, "status", 10, {"from": "running", "to": "idle"}))
        # Order matches mock's timeline iteration: tt-7 start, tt-11 end
        _task_create(backend, 10, "tt-7", "Update CHANGELOG", "Updating changelog", turn=104)
        _task_complete(qa, 10, "tt-11", turn=101)

        # ════════════════════════════════════════════════════════
        # 9 min ago: Backend asks question (QUESTION — answered)
        # ════════════════════════════════════════════════════════
        tu_question = str(uuid.uuid4())
        messages.append(_msg(backend, "assistant", [
            {"type": "tool_use", "id": tu_question, "name": "AskUserQuestion", "input": {
                "questions": [
                    {
                        "question": "The token cache needs a TTL policy. Which approach should I use?",
                        "header": "Cache TTL",
                        "options": [
                            {"label": "Short TTL (5 min)", "description": "More secure, more refresh calls"},
                            {"label": "Match token expiry", "description": "Cache until token actually expires"},
                            {"label": "Sliding window", "description": "Reset TTL on each access"},
                        ],
                        "multiSelect": False,
                    },
                ],
            }},
        ], 9, now, turn_number=11, stop_reason="tool_use"))
        messages.append(_msg(backend, "user", [
            {"type": "tool_result", "tool_use_id": tu_question, "content": "Match token expiry", "is_error": False},
        ], 9, now, turn_number=11))

        # ════════════════════════════════════════════════════════
        # 8 min ago: User sends tweak request + timeline tasks start
        # Lead tt-4, Frontend tt-9
        # ════════════════════════════════════════════════════════
        _task_create(lead, 8, "tt-4", "Sprint wrap-up & summary", "Wrapping up", turn=106)
        _task_create(frontend, 8, "tt-9", "Adjust pulse animation speed", "Adjusting animation", turn=102)
        messages.append(_msg(frontend, "user", [
            {"type": "text", "text": "Can you make the status dot pulse animation slower? The current 2s feels frantic."},
        ], 8, now, turn_number=8))

        # ════════════════════════════════════════════════════════
        # 7 min ago: Frontend acknowledges (AGENT_TEXT)
        # ════════════════════════════════════════════════════════
        messages.append(_msg(frontend, "assistant", [
            {"type": "text", "text": "Sure, slowing the pulse to 3s with a gentler easing curve."},
        ], 7, now, turn_number=9, stop_reason="end_turn"))

        # ════════════════════════════════════════════════════════
        # 6 min ago: Frontend applies tweak (ACTIVITY — Edit)
        # ════════════════════════════════════════════════════════
        tu_css = str(uuid.uuid4())
        messages.append(_msg(frontend, "assistant", [
            {"type": "tool_use", "id": tu_css, "name": "Edit", "input": {
                "file_path": "app/globals.css",
                "old_string": "  animation: border-pulse 2s ease-in-out infinite !important;",
                "new_string": "  animation: border-pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite !important;",
            }},
        ], 6, now, turn_number=10, stop_reason="tool_use"))
        messages.append(_msg(frontend, "user", [
            {"type": "tool_result", "tool_use_id": tu_css, "content": "Applied edit to app/globals.css", "is_error": False},
        ], 6, now, turn_number=10))

        # ════════════════════════════════════════════════════════
        # 5 min ago: Frontend tt-9 ends
        # ════════════════════════════════════════════════════════
        _task_complete(frontend, 5, "tt-9", turn=103)

        # ════════════════════════════════════════════════════════
        # 4 min ago: Lead wraps up (AGENT_TEXT) + tt-4 ends
        # ════════════════════════════════════════════════════════
        messages.append(_msg(lead, "assistant", [
            {"type": "text", "text": "Sprint complete. Auth race condition fixed, agent card redesigned, all tests passing. Total session cost: $2.83."},
        ], 4, now, turn_number=4, stop_reason="end_turn"))
        _task_complete(lead, 4, "tt-4", turn=107)

        # ════════════════════════════════════════════════════════
        # 3 min ago: Frontend tt-10 starts (in_progress — no end)
        # ════════════════════════════════════════════════════════
        _task_create(frontend, 3, "tt-10", "Scope animation change", "Scoping changes", turn=104)

        # ════════════════════════════════════════════════════════
        # 2 min ago: Backend updates changelog (ACTIVITY — Read + Edit)
        # ════════════════════════════════════════════════════════
        tu_chread = str(uuid.uuid4())
        tu_chedit = str(uuid.uuid4())
        messages.append(_msg(backend, "assistant", [
            {"type": "tool_use", "id": tu_chread, "name": "Read", "input": {"file_path": "CHANGELOG.md"}},
            {"type": "tool_use", "id": tu_chedit, "name": "Edit", "input": {
                "file_path": "CHANGELOG.md",
                "old_string": "## [Unreleased]",
                "new_string": "## [Unreleased]\n- Fixed auth token refresh race condition (mutex lock on concurrent refresh)\n- Added error handling for failed token refresh attempts",
            }},
        ], 2, now, turn_number=12, stop_reason="tool_use"))
        messages.append(_msg(backend, "user", [
            {"type": "tool_result", "tool_use_id": tu_chread, "content": "# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-02-10\n- Added agent card component\n- Improved token refresh logic", "is_error": False},
            {"type": "tool_result", "tool_use_id": tu_chedit, "content": "Applied edit to CHANGELOG.md", "is_error": False},
        ], 2, now, turn_number=12))

        # ════════════════════════════════════════════════════════
        # 1 min ago: Backend wraps up (AGENT_TEXT) + tt-7 ends
        # ════════════════════════════════════════════════════════
        messages.append(_msg(backend, "assistant", [
            {"type": "text", "text": "Updated CHANGELOG with the auth fix entry."},
        ], 1, now, turn_number=13, stop_reason="end_turn"))
        _task_complete(backend, 1, "tt-7", turn=105)

        # ════════════════════════════════════════════════════════
        # 0.5 min ago: Frontend pending multi-question (QUESTION — unanswered)
        # ════════════════════════════════════════════════════════
        tu_mq = str(uuid.uuid4())
        messages.append(_msg(frontend, "assistant", [
            {"type": "tool_use", "id": tu_mq, "name": "AskUserQuestion", "input": {
                "questions": [
                    {
                        "question": "The pulse animation change affects all status dots globally. Should I scope it to agent cards only, or keep it global?",
                        "header": "Scope",
                        "options": [
                            {"label": "Agent cards only", "description": "Scoped — other dots keep the original timing"},
                            {"label": "Global change", "description": "All status dots use the slower pulse"},
                        ],
                        "multiSelect": False,
                    },
                    {
                        "question": "Which easing curve for the new pulse?",
                        "header": "Easing",
                        "options": [
                            {"label": "ease-in-out", "description": "Smooth, natural feel"},
                            {"label": "cubic-bezier", "description": "Custom snappy curve with soft tail"},
                            {"label": "linear", "description": "Mechanical, constant rate"},
                        ],
                        "multiSelect": False,
                    },
                ],
            }},
        ], 0.5, now, turn_number=11, stop_reason="tool_use"))
        # No tool_result yet — question is pending

        # ── Bulk create Messages ──
        created_msgs = Message.objects.bulk_create(messages)
        _fix_timestamps(Message, created_msgs)
        self.stdout.write(f"Created {len(created_msgs)} messages")

        # ── Bulk create Events ──
        created_events = AgentEvent.objects.bulk_create(events)
        _fix_timestamps(AgentEvent, created_events)
        self.stdout.write(f"Created {len(created_events)} events")

        # ── SessionResults (cost timeline) ──
        # Project-wide cumulative: sum of latest per-agent SR at each point.
        # Final totals: lead=$1.42, backend=$0.67, frontend=$0.53, qa=$0.21 → $2.83
        def _sr(agent, cost, duration_ms, num_turns, mins):
            sr = SessionResult(
                agent=agent,
                session_id=agent.session_id,
                total_cost_usd=Decimal(cost),
                duration_ms=duration_ms,
                num_turns=num_turns,
            )
            sr._desired_ts = _mins_ago(now, mins)
            return sr

        # SessionResults calibrated to match mock's per-item cost formula.
        # Each SR is placed 0.01min before the cost-producing feed item so
        # _inject_costs sees the correct per-agent total at that item's timestamp.
        # Per-agent running totals match mock's cost increments exactly.
        session_results = [
            # Lead — 4 snapshots (agent-text @ 42, 19, 18, 4 min)
            _sr(lead, "0.16", 60000, 1, 42.01),
            _sr(lead, "0.32", 180000, 2, 19.01),
            _sr(lead, "0.48", 210000, 3, 18.01),
            _sr(lead, "0.64", 360000, 4, 4.01),

            # Backend — 12 snapshots
            _sr(backend, "0.05", 30000, 3, 39.01),     # agent-text @ 39
            _sr(backend, "0.29", 60000, 4, 38.01),     # activity(3) @ 38
            _sr(backend, "0.34", 90000, 5, 34.01),     # agent-text @ 34
            _sr(backend, "0.50", 120000, 6, 33.01),    # activity(2) @ 33
            _sr(backend, "0.52", 130000, 7, 32.01),    # memory @ 32
            _sr(backend, "0.60", 150000, 8, 28.01),    # activity(1) @ 28
            _sr(backend, "0.64", 160000, 8, 27.01),    # error event @ 27
            _sr(backend, "0.69", 170000, 9, 26.01),    # agent-text @ 26
            _sr(backend, "0.85", 190000, 10, 25.01),   # activity(2) @ 25
            _sr(backend, "0.90", 240000, 11, 9.01),    # question @ 9
            _sr(backend, "1.06", 270000, 12, 2.01),    # activity(2) @ 2
            _sr(backend, "1.11", 280000, 13, 1.01),    # agent-text @ 1

            # Frontend — 10 snapshots
            _sr(frontend, "0.06", 30000, 1, 37.01),    # plan(content) @ 37
            _sr(frontend, "0.08", 35000, 2, 36.51),    # plan(approved) @ 36.5
            _sr(frontend, "0.13", 40000, 3, 36.01),    # agent-text @ 36
            _sr(frontend, "0.29", 60000, 4, 35.01),    # activity(2) @ 35
            _sr(frontend, "0.53", 120000, 5, 30.01),   # activity(3) @ 30
            _sr(frontend, "0.58", 140000, 6, 22.01),   # agent-text @ 22
            _sr(frontend, "0.74", 160000, 7, 21.01),   # activity(2) @ 21
            _sr(frontend, "0.79", 200000, 9, 7.01),    # agent-text @ 7
            _sr(frontend, "0.87", 220000, 10, 6.01),   # activity(1) @ 6
            _sr(frontend, "0.92", 240000, 11, 0.51),   # question @ 0.5

            # QA — 4 snapshots
            _sr(qa, "0.16", 30000, 1, 16.01),          # activity(2) @ 16
            _sr(qa, "0.21", 40000, 2, 15.01),          # agent-text @ 15
            _sr(qa, "0.29", 60000, 3, 14.01),          # activity(1) @ 14
            _sr(qa, "0.34", 90000, 4, 11.01),          # agent-text @ 11
        ]
        created_srs = SessionResult.objects.bulk_create(session_results)
        _fix_timestamps(SessionResult, created_srs)
        self.stdout.write(f"Created {len(created_srs)} session results")

        # Update agent costs
        for name, cost in [("lead", "1.42"), ("backend", "0.67"), ("frontend", "0.53"), ("qa", "0.21")]:
            Agent.objects.filter(id=agents[name].id).update(session_cost_usd=Decimal(cost))

        self.stdout.write(self.style.SUCCESS(
            f"\nDone! Project ID: {project.id}\n"
            f"  Use in GraphQL: projectFeed(projectId: \"{project.id}\")"
        ))
