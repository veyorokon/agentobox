"use client"

import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react"
import {
  ArrowUp,
  Users,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  X,
  AlertCircle,
  Paperclip,
  Plus,

  Clock,
  DollarSign,
  RotateCcw,
  CheckSquare,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
  RefreshCw,
  ChevronsUpDown,
  ChevronsDownUp,
  Settings,
  Monitor,
  List,
  BookOpen,
  Search,
  Filter,
  Tag,
  Shield,
} from "lucide-react"
import { cn, agentHue, formatCost } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible } from "@/components/ui/collapsible"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { CopyButton } from "@/components/shared/copy-button"

/* ================================================================== */
/*  FAKE DATA                                                          */
/* ================================================================== */

type LifecycleStatus = "deploying" | "running" | "waiting" | "error" | "idle" | "stopped"
type AttentionLevel = "none" | "review" | "plan" | "permission"

type FakeAgent = {
  id: string
  name: string
  lifecycleStatus: LifecycleStatus
  attentionLevel: AttentionLevel
  task: string
  cost: number
  duration: string
  model: string
  turns: number
  lastOutput: string
  phase?: string
  /** Live one-liner: last tool call or action, continuously updated.
   *  SOURCE: latest tool_use content block name + summary from StreamEvent */
  liveAction?: string
  /** Compact todo progress for live status bar */
  todoProgress?: { done: number; total: number }
  instructions: string
  mcpServers: string[]
  runtime: "docker" | "modal"
  workspacePath: string
  tags: string[]
  mode: "auto" | "plan" | "supervised"
}

type RecipientEntry =
  | { type: "agent"; value: string }
  | { type: "tag"; value: string }
  | { type: "all" }

const INITIAL_AGENTS: FakeAgent[] = [
  {
    id: "0",
    name: "team-lead",
    lifecycleStatus: "running",
    attentionLevel: "none",
    task: "Coordinating sprint tasks",
    cost: 0.18,
    duration: "12m 05s",
    model: "Opus 4.6",
    turns: 14,
    lastOutput: "Delegated auth fix to backend, waiting on QA...",
    phase: "Planning",
    liveAction: "Reviewing agent progress",
    todoProgress: { done: 3, total: 5 },
    instructions: "Orchestrate the team. Break down tasks, delegate to specialists, track progress, resolve blockers. You are the single point of contact for the human.",
    mcpServers: [],
    runtime: "docker",
    workspacePath: "/workspace/agentobox",
    tags: ["core"],
    mode: "plan",
  },
  {
    id: "1",
    name: "backend",
    lifecycleStatus: "running",
    attentionLevel: "none",
    task: "Editing auth.ts — fixing JWT validation",
    cost: 0.12,
    duration: "3m 22s",
    model: "Opus 4.6",
    turns: 8,
    lastOutput: "Applied fix to validateToken()...",
    phase: "Editing",
    liveAction: "Edit src/auth.ts (+3 -1)",
    todoProgress: { done: 5, total: 6 },
    instructions: "Django 6.0 backend: models, services, auth, GraphQL schema. Run tests before committing.",
    mcpServers: ["computer-use"],
    runtime: "docker",
    workspacePath: "/workspace/agentobox",
    tags: ["backend", "core"],
    mode: "plan",
  },
  {
    id: "2",
    name: "frontend",
    lifecycleStatus: "running",
    attentionLevel: "none",
    task: "Reading component styles",
    cost: 0.08,
    duration: "1m 45s",
    model: "Sonnet 4.6",
    turns: 4,
    lastOutput: "Scanning tailwind classes in Button...",
    phase: "Reading",
    liveAction: "Read src/components/Button.tsx",
    instructions: "Next.js dashboard: components, stores, GraphQL client, Tailwind CSS. Follow design tokens.",
    mcpServers: ["playwright", "computer-use"],
    runtime: "docker",
    workspacePath: "/workspace/agentobox",
    tags: ["frontend", "core"],
    mode: "auto",
  },
  {
    id: "3",
    name: "qa",
    lifecycleStatus: "error",
    attentionLevel: "permission",
    task: "npm test failed",
    cost: 0.05,
    duration: "2m 10s",
    model: "Sonnet 4.6",
    turns: 3,
    lastOutput: "FAIL src/auth.test.ts\nExpected 200, received 401",
    liveAction: "Bash npm test -- --filter auth",
    instructions: "Run test suites, deploy test agents, Playwright E2E. Report failures with reproduction steps.",
    mcpServers: ["playwright"],
    runtime: "docker",
    workspacePath: "/workspace/agentobox",
    tags: ["testing", "ci"],
    mode: "supervised",
  },
  {
    id: "4",
    name: "devops",
    lifecycleStatus: "waiting",
    attentionLevel: "plan",
    task: "Waiting for backend",
    cost: 0.03,
    duration: "5m 00s",
    model: "Haiku 4.5",
    turns: 1,
    lastOutput: "Standing by...",
    instructions: "Infrastructure: Docker, CI/CD, Modal config, monitoring. No destructive ops without approval.",
    mcpServers: ["computer-use"],
    runtime: "modal",
    workspacePath: "/workspace/agentobox",
    tags: ["infra", "ci"],
    mode: "auto",
  },
  {
    id: "5",
    name: "docs",
    lifecycleStatus: "stopped",
    attentionLevel: "review",
    task: "Completed README update",
    cost: 0.02,
    duration: "1m 30s",
    model: "Haiku 4.5",
    turns: 2,
    lastOutput: "Updated API reference section",
    liveAction: "Edit docs/api-reference.md (+12 -3)",
    instructions: "Documentation: API reference, architecture docs, migration guides. Keep examples current.",
    mcpServers: [],
    runtime: "docker",
    workspacePath: "/workspace/agentobox",
    tags: ["docs"],
    mode: "auto",
  },
  {
    id: "6",
    name: "infra",
    lifecycleStatus: "deploying",
    attentionLevel: "none",
    task: "Provisioning container",
    cost: 0.00,
    duration: "0m 12s",
    model: "Haiku 4.5",
    turns: 0,
    lastOutput: "Initializing workspace...",
    instructions: "Provisioning: container orchestration, volume management, network config.",
    mcpServers: [],
    runtime: "modal",
    workspacePath: "/workspace/agentobox",
    tags: ["infra"],
    mode: "supervised",
  },
]

type FakeSecret = {
  id: string
  key: string
  value: string
  addedAgo: string
}

const SECRETS: FakeSecret[] = [
  { id: "s1", key: "GITHUB_TOKEN", value: "ghp_a1b2c3d4e5f6g7h8i9j0", addedAgo: "2d ago" },
  { id: "s2", key: "ANTHROPIC_API_KEY", value: "sk-ant-api03-xxxxxxxxxxxx", addedAgo: "5d ago" },
  { id: "s3", key: "AWS_ACCESS_KEY_ID", value: "AKIAIOSFODNN7EXAMPLE", addedAgo: "1w ago" },
  { id: "s4", key: "OPENAI_API_KEY", value: "sk-proj-xxxxxxxxxxxxxxxx", addedAgo: "1w ago" },
]

/* ================================================================== */
/*  SKILLS DATA                                                        */
/* ================================================================== */

type Skill = {
  id: string
  name: string
  description: string
  content: string
  assignedTags: string[]
  steps?: number
}

const SKILLS: Skill[] = [
  {
    id: "sk1",
    name: "Test Failure Triage",
    description: "Systematic approach to diagnosing test failures",
    assignedTags: ["testing", "core"],
    steps: 5,
    content: `# Test Failure Triage

1. **Read the error message** — don't skip to the code. The error tells you what failed, the stack trace tells you where.
2. **Reproduce locally** — run the exact failing test in isolation:
   \`\`\`bash
   npm test -- --filter <test-name>
   \`\`\`
   - If it passes locally, the issue is environment-specific
   - If it fails, you have a local repro
3. **Check recent changes** — \`git log --oneline -10\` in the affected area
   - Did a dependency change?
   - Did a related module change its contract?
4. **Isolate the assertion** — which specific assertion fails?
   - Expected vs actual values
   - Is the test wrong or the code wrong?
5. **Fix and verify** — apply the fix, run the full suite:
   - Run the specific test
   - Run the full suite to check for regressions
   - If flaky, add a note about the flakiness pattern`,
  },
  {
    id: "sk2",
    name: "Frontend Design Guidelines",
    description: "Typography, color, and motion standards",
    assignedTags: ["frontend"],
    content: `# Frontend Design Guidelines

## Typography
Use the system font stack. Body text at 14px, labels at 11px, headings at 16-20px. Monospace for code, data, and technical content. Line height: 1.5 for body, 1.2 for headings.

## Color
Follow the semantic token system. Never use raw hex values — always reference design tokens (\`text-default\`, \`text-muted\`, \`bg-surface\`, etc.). Status colors: success (green), warning (amber), danger (red), info (blue), accent (brand purple).

## Motion
Transitions at 150ms for micro-interactions (hover, focus), 200ms for reveals (collapsible, dropdown), 300ms for layout shifts (panel resize). Use \`ease-out\` for enters, \`ease-in\` for exits. No animation on reduced-motion preference.

## Spacing
Use the 4px grid. Common values: 4, 8, 12, 16, 24, 32. Padding inside cards: 12px. Gap between cards: 8px. Section spacing: 16-24px.`,
  },
  {
    id: "sk3",
    name: "PR Review Checklist",
    description: "Code review standards for all pull requests",
    assignedTags: ["core"],
    steps: 5,
    content: `# PR Review Checklist

1. **Scope check** — does the PR do one thing? If the title needs "and", it should be two PRs.
2. **Read the tests first** — tests document intent. If there are no tests, that's the first comment.
3. **Check the unhappy path** — error handling, edge cases, null/undefined guards at boundaries.
   > Note: internal code trusts normalized data — only validate at system boundaries.
4. **Review naming** — do variable/function names describe what they DO, not what they ARE? \`fetchUserProfile\` > \`getData\`.
5. **Check for regressions** — does this change break existing behavior? Look for:
   - Changed function signatures
   - Removed exports
   - Modified database schemas
   - Altered API response shapes`,
  },
  {
    id: "sk4",
    name: "Deploy Verification",
    description: "Post-deploy health checks and rollback criteria",
    assignedTags: ["infra", "ci"],
    steps: 3,
    content: `# Deploy Verification

1. **Health check** — hit the health endpoint within 30s of deploy:
   \`\`\`bash
   curl -s https://api.example.com/health | jq .
   \`\`\`
   - If status != "ok" → **rollback immediately**
   - If latency > 2s → investigate but don't rollback yet
2. **Smoke test core flows** — run the critical path tests:
   - Authentication (login, token refresh)
   - Primary CRUD operations
   - WebSocket connections (if applicable)
   - If any fail → **rollback**
3. **Monitor for 15 minutes** — watch error rates and p99 latency:
   - Error rate > 1% → **rollback**
   - p99 latency > 2x baseline → investigate
   - All clear after 15m → deploy is stable`,
  },
]

function getAgentSkills(agent: FakeAgent): Skill[] {
  return SKILLS.filter(s => s.assignedTags.some(tag => agent.tags.includes(tag)))
}

/** All unique tags across agents */
const ALL_TAGS = Array.from(new Set(INITIAL_AGENTS.flatMap(a => a.tags))).sort()

/**
 * FAKE_MARKDOWN — used in right-panel agent detail feed.
 * SOURCE: TimelineEntry.content (full assistant message content blocks)
 * This is the VERBOSE output — only shown when drilling into an agent.
 */
const FAKE_MARKDOWN = `I've analyzed the JWT validation issue. The problem is in \`validateToken()\` — the expiry comparison uses **seconds** but \`Date.now()\` returns **milliseconds**.

Here's the fix:

\`\`\`typescript
function validateToken(token: string): boolean {
  const decoded = jwt.decode(token)
  const now = Math.floor(Date.now() / 1000) // Convert to seconds
  return decoded.exp > now
}
\`\`\`

The changes needed:
- Convert \`Date.now()\` to seconds before comparison
- Add a 30-second clock skew tolerance
- Log validation failures for debugging

| Before | After |
|--------|-------|
| \`Date.now()\` (ms) | \`Math.floor(Date.now() / 1000)\` (s) |
| No skew tolerance | 30s tolerance |
| Silent failures | Structured logging |`

/* ================================================================== */
/*  TEAM FEED DATA — main feed shows summaries, not verbose output    */
/*                                                                     */
/*  Data sources:                                                      */
/*  - "summary" items → TimelineEntry.summary (agent turn result)     */
/*  - "user" items → user messages (sent via composer / @mention)     */
/*  - "status" items → agent status transitions (StreamEvent)         */
/*  - "error" items → agent error events (StreamEvent with isError)   */
/*  - "system" items → session lifecycle events                        */
/*  - "question" items → AskUserQuestion tool_use in content blocks   */
/* ================================================================== */

type TeamFeedItem =
  | { type: "system"; text: string }
  | { type: "user"; text: string; target?: string }
  | { type: "summary"; agent: string; summary: string; cost: number; turns: number; duration: string; isError?: boolean }
  | { type: "status"; agent: string; from: string; to: string }
  | { type: "error"; agent: string; text: string }
  | { type: "question"; agent: string; question: string; options: string[] }
  | { type: "plan"; agent: string; title: string; plan: string; planStatus: "pending" | "approved" | "rejected" | "superseded" }
  | { type: "permission"; agent: string; command: string; risk?: string; permStatus: "pending" | "allowed" | "denied" }
  | { type: "multi-question"; agent: string; questions: { text: string; options: string[] }[] }
  | { type: "agent-message"; from: string; to: string; text: string }

const TEAM_FEED: TeamFeedItem[] = [
  // Session start
  { type: "system", text: "session started · Opus 4.6 · 47 tools · 6 agents" },

  // User dispatches work to the team
  { type: "user", text: "Fix the JWT validation bug in auth.ts. The token expiry check is off by one hour.", target: "backend" },
  { type: "user", text: "Run the test suite after backend finishes and report results.", target: "qa" },
  { type: "user", text: "Update the API docs once the fix lands.", target: "docs" },

  // Agents start working — status transitions
  { type: "status", agent: "backend", from: "idle", to: "running" },
  { type: "status", agent: "qa", from: "idle", to: "waiting" },
  { type: "status", agent: "docs", from: "idle", to: "running" },

  // Backend proposes a plan before starting work
  {
    type: "plan",
    agent: "backend",
    title: "Fix JWT validation and add clock skew tolerance",
    plan: `## Context

The JWT validation middleware rejects tokens within 5s of expiry due to \`Date.now()\` returning milliseconds while the JWT \`exp\` claim uses seconds. This causes intermittent 401s during peak traffic when server clocks drift.

## Changes

1. **Fix the unit mismatch** — Replace \`Date.now()\` with \`Math.floor(Date.now() / 1000)\` in the expiry comparison inside \`validateToken()\`
2. **Add clock skew tolerance** — Pass \`clockTolerance: 30\` to \`jsonwebtoken.verify()\` options, configurable via \`AUTH_CLOCK_SKEW_SECONDS\` env var
3. **Structured error logging** — Log validation failures with token claims and expected vs actual timestamps for debugging

## Files

- \`backend/middleware/auth.ts\` — main fix + logging
- \`backend/config/auth.ts\` — new \`clockTolerance\` config
- \`backend/tests/auth.test.ts\` — new test cases for skew tolerance

## Verification

- Existing auth tests still pass
- New test: token with exp = now - 25s should be accepted (within tolerance)
- New test: token with exp = now - 35s should be rejected (outside tolerance)`,
    planStatus: "approved",
  },

  // Backend finishes first turn — SUMMARY (not the full verbose output)
  {
    type: "summary",
    agent: "backend",
    summary: "Fixed JWT validation — converted Date.now() to seconds, added 30s clock skew tolerance, updated error logging in validateToken()",
    cost: 0.08,
    turns: 5,
    duration: "2m 10s",
  },

  // Backend asks multiple questions about auth strategy
  {
    type: "multi-question",
    agent: "backend",
    questions: [
      {
        text: "Which token storage strategy should we use for refresh tokens?",
        options: ["HTTP-only cookies", "In-memory + secure storage", "Session storage"],
      },
      {
        text: "Should we enforce single-session or allow multiple concurrent sessions?",
        options: ["Single session (revoke old on new login)", "Multiple sessions (up to 5)", "Unlimited sessions"],
      },
    ],
  },

  // Backend asks a question
  {
    type: "question",
    agent: "backend",
    question: "Should I also add refresh token rotation while I'm in auth.ts?",
    options: ["Yes, add rotation", "No, just the fix", "Create a separate task for it"],
  },

  // User responds
  { type: "user", text: "Yes, add rotation. Good catch." },

  // QA picks up after backend
  { type: "status", agent: "qa", from: "waiting", to: "running" },

  // Backend finishes second turn
  {
    type: "summary",
    agent: "backend",
    summary: "Added refresh token rotation — tokens now rotate on each refresh, old tokens invalidated after 60s grace period. Updated 3 test fixtures.",
    cost: 0.04,
    turns: 3,
    duration: "1m 12s",
  },

  // QA reports failure
  {
    type: "error",
    agent: "qa",
    text: "2 assertions failed in auth.test.ts:\n  - Expected 200 on /api/refresh, got 401\n  - Token rotation test expects old format",
  },
  { type: "status", agent: "qa", from: "running", to: "error" },

  // Backend pings QA about the fix
  { type: "agent-message", from: "backend", to: "qa", text: "auth endpoints updated — refresh rotation uses new token format now, you may need to update fixtures" },

  // User directs backend to fix
  { type: "user", text: "@backend the refresh endpoint still rejects — check the middleware order", target: "backend" },

  // Backend fixes it
  {
    type: "summary",
    agent: "backend",
    summary: "Fixed middleware ordering — auth middleware now runs after token refresh handler. Updated test fixtures to match new rotation format.",
    cost: 0.04,
    turns: 3,
    duration: "1m 00s",
  },

  // QA reruns and passes
  { type: "status", agent: "qa", from: "error", to: "running" },
  {
    type: "summary",
    agent: "qa",
    summary: "All 47 tests passing. Auth suite: 12/12 pass. Refresh rotation: 3/3 pass. No regressions detected.",
    cost: 0.05,
    turns: 5,
    duration: "2m 10s",
  },

  // QA tells devops the branch is green
  { type: "agent-message", from: "qa", to: "devops", text: "fix/jwt-validation is green — 47/47 tests pass, safe to deploy" },

  // QA requests permission to push
  {
    type: "permission",
    agent: "qa",
    command: "git push origin fix/jwt-validation",
    risk: "Pushes to remote branch",
    permStatus: "pending",
  },

  // Devops proposes a deployment plan
  {
    type: "plan",
    agent: "devops",
    title: "Deploy auth fix to staging",
    plan: `## Context

The auth hotfix on \`fix/jwt-validation\` needs to reach staging for QA verification before the Friday production rollout window.

## Steps

1. Build Docker image from \`fix/jwt-validation\` branch, tag as \`staging-candidate\`
2. Run full auth integration test suite against staging database with new image
3. Blue-green deploy — swap staging traffic to new containers, drain old ones within 60s grace period

## Files

- \`backend/Dockerfile\`
- \`docker-compose.staging.yml\`
- \`tests/integration/auth.test.ts\`
- \`infra/staging/deploy.yaml\`

## Rollback

If integration tests fail or health checks don't pass within 120s, automatically revert to the previous deployment. No manual intervention needed.`,
    planStatus: "pending" as const,
  },

  // Docs finishes
  {
    type: "summary",
    agent: "docs",
    summary: "Updated API reference — added refresh token rotation docs, updated auth flow diagram, added migration notes for v2 token format.",
    cost: 0.02,
    turns: 2,
    duration: "1m 30s",
  },
  { type: "status", agent: "docs", from: "running", to: "stopped" },

  // Session summary
  { type: "system", text: "3 agents completed · 18 turns · $0.23 total" },
]

/* ================================================================== */
/*  STATUS + ATTENTION CONFIG                                          */
/* ================================================================== */

const ATTENTION_PRIORITY: Record<AttentionLevel, number> = { none: 0, review: 1, plan: 2, permission: 3 }
const LIFECYCLE_PRIORITY: Record<LifecycleStatus, number> = { stopped: 0, idle: 1, deploying: 2, waiting: 3, running: 4, error: 5 }

const LIFECYCLE_CONFIG: Record<LifecycleStatus, { dot: string; label: string; text: string; glow?: string }> = {
  running:   { dot: "bg-success",   label: "Running",  text: "text-success", glow: "text-success" },
  idle:      { dot: "bg-info",      label: "Idle",     text: "text-info" },
  waiting:   { dot: "bg-warning",   label: "Waiting",  text: "text-warning" },
  error:     { dot: "bg-danger",    label: "Error",    text: "text-danger" },
  stopped:   { dot: "bg-muted/50",  label: "Stopped",  text: "text-muted" },
  deploying: { dot: "bg-accent",    label: "Starting", text: "text-accent" },
}

const ATTENTION_CONFIG: Record<Exclude<AttentionLevel, "none">, { dot: string; label: string; text: string; pulse: boolean }> = {
  review:     { dot: "bg-success", label: "Review",     text: "text-success", pulse: false },
  plan:       { dot: "bg-warning", label: "Plan",       text: "text-warning", pulse: true },
  permission: { dot: "bg-info",    label: "Permission", text: "text-info",    pulse: true },
}

// Priority order (highest first) — used for attention derivation
const ATTENTION_PILL_ORDER: (Exclude<AttentionLevel, "none">)[] = ["permission", "plan", "review"]

/* ================================================================== */
/*  UTILITY FUNCTIONS                                                   */
/* ================================================================== */

function getHighestAttention(agents: FakeAgent[]): AttentionLevel {
  let highest: AttentionLevel = "none"
  for (const a of agents) {
    if (a.attentionLevel === "permission") return "permission" // early exit at max
    if (ATTENTION_PRIORITY[a.attentionLevel] > ATTENTION_PRIORITY[highest]) {
      highest = a.attentionLevel
    }
  }
  return highest
}

type PendingItem = Extract<TeamFeedItem, { type: "permission" }> | Extract<TeamFeedItem, { type: "plan" }>

function getPendingItemsForAgent(feedItems: TeamFeedItem[], agentName: string): PendingItem[] {
  return feedItems.filter((item): item is PendingItem =>
    (item.type === "permission" && item.agent === agentName && item.permStatus === "pending") ||
    (item.type === "plan" && item.agent === agentName && item.planStatus === "pending"),
  )
}

function getAllPendingItems(feedItems: TeamFeedItem[]): PendingItem[] {
  return feedItems.filter((item): item is PendingItem =>
    (item.type === "permission" && item.permStatus === "pending") ||
    (item.type === "plan" && item.planStatus === "pending"),
  )
}

function deriveAttentionFromFeed(feedItems: TeamFeedItem[], agentName: string): AttentionLevel {
  const pending = getPendingItemsForAgent(feedItems, agentName)
  let highest: AttentionLevel = "none"
  for (const item of pending) {
    const level: AttentionLevel = item.type === "permission" ? "permission" : "plan"
    if (ATTENTION_PRIORITY[level] > ATTENTION_PRIORITY[highest]) highest = level
  }
  return highest
}

/* ================================================================== */
/*  AGENT REDUCER                                                       */
/* ================================================================== */

type AgentAction =
  | { type: "SET_LIFECYCLE"; agentId: string; status: LifecycleStatus }
  | { type: "SET_ATTENTION"; agentId: string; level: AttentionLevel }
  | { type: "ACKNOWLEDGE"; agentId: string }
  | { type: "RESET" }

function agentReducer(state: FakeAgent[], action: AgentAction): FakeAgent[] {
  switch (action.type) {
    case "SET_LIFECYCLE":
      return state.map(a => a.id === action.agentId ? { ...a, lifecycleStatus: action.status } : a)
    case "SET_ATTENTION":
      return state.map(a => a.id === action.agentId ? { ...a, attentionLevel: action.level } : a)
    case "ACKNOWLEDGE":
      return state.map(a => a.id === action.agentId && a.attentionLevel === "review" ? { ...a, attentionLevel: "none" } : a)
    case "RESET":
      return INITIAL_AGENTS
    default:
      return state
  }
}

const MODE_CONFIG = {
  auto: { label: "auto", color: "text-success" },
  plan: { label: "plan", color: "text-warning" },
  supervised: { label: "supervised", color: "text-info" },
} as const

/* ================================================================== */
/*  MODE PILL                                                          */
/* ================================================================== */

function ModePill({
  mode,
  onChange,
}: {
  mode: "auto" | "plan" | "supervised"
  onChange: (mode: "auto" | "plan" | "supervised") => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cfg = MODE_CONFIG[mode]

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        className={cn("text-[10px] font-medium transition-colors hover:opacity-80", cfg.color)}
      >
        {cfg.label}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-28 rounded-md border border-border-default bg-surface-raised shadow-lg z-(--z-dropdown) overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {(Object.keys(MODE_CONFIG) as Array<keyof typeof MODE_CONFIG>).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onChange(key)
                setOpen(false)
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors",
                mode === key
                  ? cn(MODE_CONFIG[key].color, "bg-surface-sunken/40")
                  : "text-secondary hover:bg-surface-sunken/40",
              )}
            >
              {MODE_CONFIG[key].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/*  BREAKPOINT HOOK                                                    */
/* ================================================================== */

type Breakpoint = "mobile" | "S" | "M" | "L" | "XL"

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("XL")

  useEffect(() => {
    function calc() {
      const w = window.innerWidth
      if (w < 1024) setBp("mobile")
      else if (w < 1280) setBp("S")
      else if (w < 1440) setBp("M")
      else if (w < 1920) setBp("L")
      else setBp("XL")
    }
    calc()
    let raf: number
    function onResize() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(calc)
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return bp
}

/* ================================================================== */
/*  AGENT AVATAR                                                       */
/* ================================================================== */

function AgentAvatar({
  name,
  size = "md",
  stopped = false,
}: {
  name: string
  size?: "sm" | "md" | "lg"
  stopped?: boolean
}) {
  const hue = agentHue(name)
  const dims = size === "sm" ? "h-5 w-5" : size === "lg" ? "h-8 w-8" : "h-6 w-6"
  const textSize = size === "sm" ? "text-[9px]" : size === "lg" ? "text-[12px]" : "text-[10px]"
  const radius = size === "sm" ? "rounded" : "rounded-md"

  return (
    <div
      className={cn(dims, radius, "flex items-center justify-center font-bold shrink-0", textSize)}
      style={{
        backgroundColor: `hsl(${hue} ${stopped ? "25%" : "40%"} ${stopped ? "18%" : "22%"})`,
        color: `hsl(${hue} ${stopped ? "30%" : "55%"} ${stopped ? "45%" : "68%"})`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/** Round avatar for chat feed (matches assistant-message.tsx) */
function ChatAvatar({ name }: { name: string }) {
  const hue = agentHue(name)
  return (
    <div
      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-on-emphasis mt-1"
      style={{
        backgroundColor: `hsl(${hue} var(--color-avatar-saturation) var(--color-avatar-lightness))`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/* ================================================================== */
/*  FEED CONTENT COMPONENTS                                            */
/* ================================================================== */

/** 2. Assistant message with markdown — left-aligned with avatar (used in agent detail feed) */
function AssistantMessage({
  agent,
  content,
  showAvatar = true,
}: {
  agent: string
  content: string
  showAvatar?: boolean
}) {
  return (
    <div className="group/msg flex gap-2 min-w-0 relative">
      {showAvatar ? (
        <ChatAvatar name={agent} />
      ) : (
        <div className="shrink-0 w-6" />
      )}
      <div className="min-w-0 flex-1">
        {showAvatar && (
          <div className="text-[11px] text-muted font-mono mb-0.5">
            {agent}
          </div>
        )}
        <MarkdownRenderer
          content={content}
          className="text-sm text-default"
        />
      </div>
      {content.length > 0 && (
        <div className="absolute top-0 -left-6 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          <CopyButton text={content} />
        </div>
      )}
    </div>
  )
}

/** 3. Tool call group — single tool, collapsible */
function SingleToolRow({
  toolName,
  summary,
}: {
  toolName: string
  summary: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="ml-8">
      <div className="border-l-2 rounded-r border-l-muted/40">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-2 w-full text-left px-2.5 py-1 cursor-pointer hover:bg-surface-sunken/40 transition-colors"
        >
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 text-muted transition-transform duration-(--duration-normal)",
              expanded && "rotate-90",
            )}
          />
          <span className="text-xs font-medium shrink-0 text-info">
            {toolName}
          </span>
          <span className="text-xs text-muted font-mono truncate min-w-0">
            {summary}
          </span>
        </button>
        <Collapsible open={expanded}>
          <div className="px-3 py-2 ml-4">
            <div className="rounded bg-surface-sunken/60 p-2">
              <p className="font-mono text-xs text-secondary whitespace-pre-wrap">
                {toolName === "Read"
                  ? "Reading file contents... (47 lines)"
                  : toolName === "Edit"
                    ? 'old_string: "Date.now()"\nnew_string: "Math.floor(Date.now() / 1000)"'
                    : toolName === "Bash"
                      ? "$ npm run lint\n✓ No errors found"
                      : "Operation completed successfully"}
              </p>
            </div>
          </div>
        </Collapsible>
      </div>
    </div>
  )
}

/** 3b. Multi-tool group — collapsible group header */
function MultiToolGroup({
  tools,
}: {
  tools: { name: string; summary: string }[]
}) {
  const [expanded, setExpanded] = useState(false)

  const uniqueNames = tools
    .map((t) => t.name)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ")

  return (
    <div className="ml-8">
      <div className="border-l-2 rounded-r border-l-muted/40">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-2 w-full text-left px-2.5 py-1 cursor-pointer hover:bg-surface-sunken/40 transition-colors"
        >
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 text-muted transition-transform duration-(--duration-normal)",
              expanded && "rotate-90",
            )}
          />
          <span className="text-xs text-secondary">
            {tools.length} tool uses
          </span>
          <span className="text-[11px] text-muted font-mono truncate min-w-0">
            {uniqueNames}
          </span>
        </button>
        <Collapsible open={expanded}>
          <div className="ml-2 space-y-px">
            {tools.map((tool, i) => (
              <ToolRow key={i} toolName={tool.name} summary={tool.summary} />
            ))}
          </div>
        </Collapsible>
      </div>
    </div>
  )
}

function ToolRow({ toolName, summary }: { toolName: string; summary: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 w-full text-left px-2.5 py-0.5 cursor-pointer hover:bg-surface-sunken/40 transition-colors"
      >
        <ChevronRight
          size={10}
          className={cn(
            "shrink-0 text-muted transition-transform duration-(--duration-normal)",
            expanded && "rotate-90",
          )}
        />
        <span className="text-[11px] font-medium shrink-0 text-info">
          {toolName}
        </span>
        <span className="text-[11px] text-muted font-mono truncate min-w-0">
          {summary}
        </span>
      </button>
      <Collapsible open={expanded}>
        <div className="px-3 py-1.5 ml-4">
          <div className="rounded bg-surface-sunken/60 p-2">
            <p className="font-mono text-[11px] text-secondary">
              Tool output for {toolName}
            </p>
          </div>
        </div>
      </Collapsible>
    </div>
  )
}

/** 4. Result pill — compact inline status */
function ResultPill({
  isError = false,
  cost,
  duration,
  turns,
  model,
}: {
  isError?: boolean
  cost: number
  duration: string
  turns: number
  model: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="ml-8">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-mono cursor-pointer hover:bg-surface-sunken/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {isError ? (
          <X size={12} className="shrink-0 text-danger" strokeWidth={2.5} />
        ) : (
          <Check size={12} className="shrink-0 text-success" strokeWidth={2.5} />
        )}
        {cost > 0 && (
          <span className="text-secondary">{formatCost(cost)}</span>
        )}
        <span className="text-muted/50">&middot;</span>
        <span className="text-muted">{duration}</span>
        <ChevronRight
          size={10}
          className={cn(
            "shrink-0 text-muted/60 transition-transform duration-(--duration-normal) ml-0.5",
            expanded && "rotate-90",
          )}
        />
      </button>
      <Collapsible open={expanded}>
        <div className="ml-2 mt-0.5 space-y-0.5">
          <div className="text-[10px] font-mono text-muted">
            {turns} turn{turns !== 1 ? "s" : ""}
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-secondary truncate min-w-0 max-w-[140px]">
              {model}
            </span>
            <span className="text-muted">
              12.4k in / 3.2k out
            </span>
            <span className="text-muted">
              (cache: 8.1kr)
            </span>
          </div>
        </div>
      </Collapsible>
    </div>
  )
}

/** 5. Error bubble — danger-styled message */
function ErrorBubble({ agent, text }: { agent: string; text: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-danger-subtle mt-1">
        <AlertCircle className="h-3.5 w-3.5 text-danger" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-danger font-mono mb-0.5">{agent}</div>
        <div className="rounded-r bg-danger-subtle/40 border-l-2 border-l-danger px-3 py-2">
          <p className="text-xs text-danger leading-relaxed font-mono whitespace-pre-wrap">
            {text}
          </p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-danger/30 text-[11px] text-danger font-medium hover:bg-danger-subtle/60 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Restart
          </button>
        </div>
      </div>
    </div>
  )
}

/** 6. System/status message — centered tiny text */
function SystemMessage({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-px">
      <span className="text-muted/60 text-[10px] font-mono">{text}</span>
    </div>
  )
}

/** 7. AskUserQuestion card — interactive question with options */
function QuestionCard({
  agent,
  question,
  options,
}: {
  agent: string
  question: string
  options: string[]
}) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="group/msg flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
        <div className="rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-lg">
          <p className="text-sm text-default mb-3">{question}</p>
          <div className="flex flex-wrap gap-2">
            {options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(i)}
                className={cn(
                  "px-3 py-1.5 rounded-md border text-xs font-medium transition-all",
                  selected === i
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border-default text-secondary hover:border-border-strong hover:bg-surface-sunken/40",
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted/50 mt-2 font-mono">
            or type a custom response...
          </p>
        </div>
      </div>
    </div>
  )
}

/** 7b. PlanCard — feed notification line (no actions, review happens in pinned card) */
function PlanCard({
  agent,
  title,
  planStatus,
}: {
  agent: string
  title: string
  plan: string
  planStatus: "pending" | "approved" | "rejected" | "superseded"
}) {
  if (planStatus === "superseded") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-muted">
          Plan: {title} · superseded
        </span>
      </div>
    )
  }

  if (planStatus === "approved") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-success">
          Plan: {title} <Check className="inline h-3 w-3" strokeWidth={2.5} /> approved
        </span>
      </div>
    )
  }

  if (planStatus === "rejected") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-muted">
          Plan: {title} <X className="inline h-3 w-3" strokeWidth={2.5} /> rejected
        </span>
      </div>
    )
  }

  // Pending — just a notification line, no card
  return (
    <div className="flex items-center gap-2 py-0.5 justify-center">
      <AgentAvatar name={agent} size="sm" />
      <span className="text-[10px] font-mono text-warning">
        Plan: {title} · awaiting review
      </span>
    </div>
  )
}

/** 7c. PermissionCard — permission request card */
function PermissionCard({
  agent,
  command,
  risk,
  permStatus: initialStatus,
}: {
  agent: string
  command: string
  risk?: string
  permStatus: "pending" | "allowed" | "denied"
}) {
  const [status, setStatus] = useState(initialStatus)

  if (status === "allowed") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-success">
          Allowed: <code className="bg-surface-sunken/60 px-1 rounded">{command}</code> <Check className="inline h-3 w-3" strokeWidth={2.5} />
        </span>
      </div>
    )
  }

  if (status === "denied") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-muted">
          Denied: <code className="bg-surface-sunken/60 px-1 rounded">{command}</code> <X className="inline h-3 w-3" strokeWidth={2.5} />
        </span>
      </div>
    )
  }

  return (
    <div className="flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-info font-mono mb-0.5">
          <Shield className="inline h-3 w-3 mr-1" />
          {agent} · Requesting permission
        </div>
        <div className="rounded-lg border border-info/20 bg-surface-raised/60 p-3 max-w-lg">
          <div className="rounded-md bg-surface-sunken/60 border border-border-subtle px-3 py-2 mb-2">
            <code className="text-xs font-mono text-default">{command}</code>
          </div>
          {risk && (
            <div className="flex items-center gap-1.5 mb-3">
              <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
              <span className="text-[11px] text-warning">{risk}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStatus("allowed")}
              className="px-3 py-1.5 rounded-md border border-success/30 text-xs font-medium text-success hover:bg-success-subtle/40 transition-colors"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => setStatus("allowed")}
              className="px-3 py-1.5 rounded-md border border-border-default text-xs font-medium text-secondary hover:bg-surface-sunken/40 transition-colors"
            >
              Allow always
            </button>
            <button
              type="button"
              onClick={() => setStatus("denied")}
              className="px-3 py-1.5 rounded-md border border-danger/30 text-xs font-medium text-danger hover:bg-danger-subtle/40 transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 7d. MultiQuestionCard — tabbed multi-question card */
function MultiQuestionCard({
  agent,
  questions,
}: {
  agent: string
  questions: { text: string; options: string[] }[]
}) {
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  if (submitted) {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-success">
          Answered {questions.length} questions <Check className="inline h-3 w-3" strokeWidth={2.5} />
        </span>
      </div>
    )
  }

  if (reviewing) {
    return (
      <div className="flex gap-2 min-w-0">
        <ChatAvatar name={agent} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
          <div className="rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-default">Review answers</span>
            </div>
            <div className="space-y-2 mb-3">
              {questions.map((q, i) => (
                <div key={i} className="text-xs">
                  <p className="text-muted mb-0.5">{q.text}</p>
                  <p className="text-default font-medium">
                    {answers[i] !== undefined ? q.options[answers[i]] : <span className="text-warning">unanswered</span>}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => { setReviewing(false); setCurrentStep(0) }}
                className="px-3 py-1.5 rounded-md border border-border-default text-xs font-medium text-secondary hover:bg-surface-sunken/40 transition-colors"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setSubmitted(true)}
                className="px-3 py-1.5 rounded-md bg-accent text-on-emphasis text-xs font-medium hover:bg-accent-hover transition-colors"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const q = questions[currentStep]
  const isLast = currentStep === questions.length - 1

  return (
    <div className="flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
        <div className="rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-lg">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-default">{q.text}</p>
            <span className="text-[10px] text-muted font-mono shrink-0 ml-2">
              {currentStep + 1} of {questions.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {q.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setAnswers((prev) => ({ ...prev, [currentStep]: i }))}
                className={cn(
                  "px-3 py-1.5 rounded-md border text-xs font-medium transition-all",
                  answers[currentStep] === i
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border-default text-secondary hover:border-border-strong hover:bg-surface-sunken/40",
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={() => setCurrentStep((s) => s - 1)}
                className="px-3 py-1.5 rounded-md border border-border-default text-xs font-medium text-secondary hover:bg-surface-sunken/40 transition-colors"
              >
                Back
              </button>
            )}
            <span className="flex-1" />
            {isLast ? (
              <button
                type="button"
                onClick={() => setReviewing(true)}
                className="px-3 py-1.5 rounded-md bg-accent text-on-emphasis text-xs font-medium hover:bg-accent-hover transition-colors"
              >
                Review & Submit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentStep((s) => s + 1)}
                className="px-3 py-1.5 rounded-md border border-accent/30 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 8. Todo/task tracking — compact checklist */
function TodoList({
  agent,
  tasks,
}: {
  agent: string
  tasks: { text: string; done: boolean }[]
}) {
  return (
    <div className="group/msg flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
        <div className="rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-md">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckSquare className="h-3.5 w-3.5 text-info" />
            <span className="text-xs font-medium text-secondary">Tasks</span>
            <span className="text-[10px] text-muted font-mono ml-auto">
              {tasks.filter((t) => t.done).length}/{tasks.length}
            </span>
          </div>
          <div className="space-y-1">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-start gap-2">
                <div
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                    task.done
                      ? "bg-success/20 border-success/40"
                      : "border-border-default",
                  )}
                >
                  {task.done && (
                    <Check className="h-2.5 w-2.5 text-success" strokeWidth={3} />
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs leading-tight",
                    task.done
                      ? "text-muted line-through"
                      : "text-secondary",
                  )}
                >
                  {task.text}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border-subtle">
            <span className="text-[10px] text-muted/50 font-mono">
              + Add task...
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 10. Thinking indicator — pulsing dots (used in agent detail feed only) */
function ThinkingIndicator({ label = "Thinking..." }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted text-[11px] font-mono">
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
      </span>
      <span>{label}</span>
    </span>
  )
}

/** 10b. Live status bar — pinned between feed and composer in agent detail */
function LiveStatusBar({ agent }: { agent: FakeAgent }) {
  return (
    <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-sunken/20 flex items-center gap-2 min-h-[28px]">
      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-breathe shrink-0" />
      <span className="text-[11px] font-mono text-secondary truncate">
        {agent.liveAction || "Working..."}
      </span>
      {agent.todoProgress && (
        <span className="ml-auto flex items-center gap-1 shrink-0">
          <CheckSquare className="h-3 w-3 text-muted/60" />
          <span className="text-[10px] font-mono text-muted">
            {agent.todoProgress.done}/{agent.todoProgress.total}
          </span>
        </span>
      )}
    </div>
  )
}

/* ================================================================== */
/*  TEAM FEED COMPONENTS — main feed (summaries, not verbose)          */
/*                                                                     */
/*  These render team-level events. No tool calls, no thinking, no     */
/*  intermediate messages. Those live in the right panel detail view.  */
/* ================================================================== */

/**
 * Agent summary card — the primary content type in the team feed.
 * SOURCE: TimelineEntry.summary field (populated when agent completes a turn)
 * Shows: agent avatar, summary text, cost/turns/duration badge
 */
function AgentSummaryCard({
  agent,
  summary,
  cost,
  turns,
  duration,
  isError = false,
  onClickAgent,
}: {
  agent: string
  summary: string
  cost: number
  turns: number
  duration: string
  isError?: boolean
  onClickAgent?: (name: string) => void
}) {
  return (
    <div className="flex gap-2.5 min-w-0">
      <button type="button" onClick={() => onClickAgent?.(agent)} className="shrink-0 cursor-pointer">
        <ChatAvatar name={agent} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] text-muted font-mono">{agent}</span>
          <span className="text-[9px] text-muted/40">&middot;</span>
          <span className="text-[9px] text-muted/50 font-mono tabular-nums">
            {turns} turn{turns !== 1 ? "s" : ""} · {duration} · {formatCost(cost)}
          </span>
        </div>
        <div
          className={cn(
            "rounded-lg border px-3 py-2",
            isError
              ? "border-danger/20 bg-danger-subtle/20"
              : "border-border-subtle bg-surface-raised/40",
          )}
        >
          <p className={cn(
            "text-sm leading-relaxed",
            isError ? "text-danger" : "text-default",
          )}>
            {summary}
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Status transition line — inline status change notification.
 * SOURCE: StreamEvent status change (agent.status field transitions)
 */
function AgentStatusLine({ agent, from, to, onClickAgent }: { agent: string; from: string; to: string; onClickAgent?: (name: string) => void }) {
  const toConfig = LIFECYCLE_CONFIG[to as LifecycleStatus] ?? LIFECYCLE_CONFIG.stopped

  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <button type="button" onClick={() => onClickAgent?.(agent)} className="shrink-0 cursor-pointer">
        <AgentAvatar name={agent} size="sm" />
      </button>
      <span className="text-[10px] text-muted font-mono">
        {agent}
      </span>
      <span className="text-[10px] text-muted/40 font-mono">{from}</span>
      <span className="text-[10px] text-muted/30">→</span>
      <span className={cn("text-[10px] font-mono font-medium", toConfig.text)}>
        {to}
      </span>
    </div>
  )
}

/**
 * Agent-to-agent message — inline with arrow between two agent avatars.
 * SOURCE: inter-agent @mention communication
 */
function AgentToAgentMessage({ from, to, text, onClickAgent }: { from: string; to: string; text: string; onClickAgent?: (name: string) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <button type="button" onClick={() => onClickAgent?.(from)} className="shrink-0 cursor-pointer">
        <AgentAvatar name={from} size="sm" />
      </button>
      <span className="text-[10px] text-muted/30">→</span>
      <button type="button" onClick={() => onClickAgent?.(to)} className="shrink-0 cursor-pointer">
        <AgentAvatar name={to} size="sm" />
      </button>
      <span className="text-[10px] text-secondary font-mono truncate max-w-md">{text}</span>
    </div>
  )
}

/**
 * Team user message — right-aligned with optional @target indicator.
 * SOURCE: user input via composer (with optional @agent targeting)
 */
function TeamUserMessage({ text, target }: { text: string; target?: string }) {
  return (
    <div className="flex justify-end py-1">
      <div className="max-w-[80%]">
        {target && (
          <div className="flex justify-end mb-0.5">
            <span className="text-[10px] text-accent font-mono">@{target}</span>
          </div>
        )}
        <div className="bg-accent/15 border border-accent/20 rounded px-3 py-1.5">
          <p className="text-default text-sm whitespace-pre-wrap leading-relaxed">
            {text}
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Team error alert — prominent error from an agent.
 * SOURCE: StreamEvent with isError flag, or TimelineEntry.summary with error content
 */
function TeamErrorAlert({ agent, text, onClickAgent }: { agent: string; text: string; onClickAgent?: (name: string) => void }) {
  return (
    <div className="flex gap-2.5 min-w-0">
      <button type="button" onClick={() => onClickAgent?.(agent)} className="shrink-0 cursor-pointer">
        <div className="w-6 h-6 rounded-full flex items-center justify-center bg-danger-subtle mt-1">
          <AlertCircle className="h-3.5 w-3.5 text-danger" />
        </div>
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-danger font-mono mb-0.5">{agent}</div>
        <div className="rounded-lg border border-danger/20 bg-danger-subtle/20 px-3 py-2">
          <p className="text-xs text-danger leading-relaxed font-mono whitespace-pre-wrap">
            {text}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-danger/30 text-[11px] text-danger font-medium hover:bg-danger-subtle/60 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-muted font-medium hover:text-secondary transition-colors"
            >
              View details →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  SECRETS MODAL                                                      */
/* ================================================================== */

function SecretsModal({
  open,
  onClose,
  agents,
}: {
  open: boolean
  onClose: () => void
  agents: FakeAgent[]
}) {
  const [secrets, setSecrets] = useState(SECRETS)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [dirty, setDirty] = useState(false)
  const [restarted, setRestarted] = useState(false)

  if (!open) return null

  const activeAgents = agents.filter((a) => a.lifecycleStatus === "running" || a.lifecycleStatus === "idle" || a.lifecycleStatus === "deploying")
  const needsRestart = dirty && !restarted

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return
    setSecrets((prev) => [
      ...prev,
      { id: `s${Date.now()}`, key: newKey.trim().toUpperCase(), value: newValue.trim(), addedAgo: "just now" },
    ])
    setNewKey("")
    setNewValue("")
    setDirty(true)
    setRestarted(false)
  }

  const handleDelete = (id: string) => {
    setSecrets((prev) => prev.filter((s) => s.id !== id))
    setDirty(true)
    setRestarted(false)
  }

  const handleRestart = () => {
    setRestarted(true)
  }

  const maskValue = (val: string) => {
    if (val.length <= 8) return "●".repeat(val.length)
    return val.slice(0, 4) + "●".repeat(Math.min(val.length - 8, 12)) + val.slice(-4)
  }

  return (
    <div
      className="fixed inset-0 z-(--z-overlay) flex items-center justify-center"
      onKeyDown={(e) => { if (e.key === "Escape") onClose() }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-surface-backdrop backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="secrets-title"
        tabIndex={-1}
        className="relative w-full max-w-lg mx-4 rounded-xl border border-border-default bg-surface-raised shadow-lg overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted" />
              <h2 id="secrets-title" className="text-sm font-semibold text-default">Project Secrets</h2>
            </div>
            <p className="text-[11px] text-muted mt-0.5 ml-6">
              Environment variables injected into agent containers
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-sunken/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Secrets list */}
        <div className="px-5 max-h-[320px] overflow-y-auto">
          {secrets.length === 0 ? (
            <div className="py-8 text-center">
              <KeyRound className="h-8 w-8 text-muted/30 mx-auto mb-2" />
              <p className="text-xs text-muted">No secrets configured</p>
            </div>
          ) : (
            <div className="space-y-px">
              {secrets.map((secret) => (
                <div
                  key={secret.id}
                  className="group flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-b-0"
                >
                  {/* Key name */}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono font-medium text-default block truncate">
                      {secret.key}
                    </span>
                    <span className="text-[10px] text-muted/50 font-mono">
                      {secret.addedAgo}
                    </span>
                  </div>

                  {/* Value (masked or revealed) */}
                  <span className="text-[11px] font-mono text-muted truncate max-w-[160px]">
                    {revealed.has(secret.id) ? secret.value : maskValue(secret.value)}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => toggleReveal(secret.id)}
                      className="p-1 rounded text-muted hover:text-secondary transition-colors"
                      title={revealed.has(secret.id) ? "Hide" : "Reveal"}
                    >
                      {revealed.has(secret.id) ? (
                        <EyeOff className="h-3 w-3" />
                      ) : (
                        <Eye className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(secret.id)}
                      className="p-1 rounded text-muted hover:text-danger transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add secret form */}
        <div className="px-5 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              placeholder="KEY_NAME"
              className="flex-1 min-w-0 bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
            />
            <input
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              className="flex-1 min-w-0 bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newKey.trim() || !newValue.trim()}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0",
                newKey.trim() && newValue.trim()
                  ? "bg-accent text-on-emphasis hover:bg-accent-hover"
                  : "bg-surface-sunken text-muted cursor-not-allowed",
              )}
            >
              Add
            </button>
          </div>
        </div>

        {/* Restart banner */}
        {needsRestart && activeAgents.length > 0 && (
          <div className="px-5 py-3 border-t border-warning/20 bg-warning-subtle/30 flex items-center gap-3">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-xs text-warning flex-1">
              {activeAgents.length} agent{activeAgents.length !== 1 ? "s" : ""} need restart to pick up changes
            </span>
            <button
              type="button"
              onClick={handleRestart}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-warning/20 text-warning text-xs font-medium hover:bg-warning/30 transition-colors shrink-0"
            >
              <RefreshCw className="h-3 w-3" />
              Restart All
            </button>
          </div>
        )}

        {/* Restarted confirmation */}
        {restarted && (
          <div className="px-5 py-3 border-t border-success/20 bg-success-subtle/30 flex items-center gap-3">
            <Check className="h-3.5 w-3.5 text-success shrink-0" />
            <span className="text-xs text-success">
              {activeAgents.length} agent{activeAgents.length !== 1 ? "s" : ""} restarting with updated environment
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  AGENT LEFT PANEL — unified icon rail + agent cards                 */
/* ================================================================== */

function AgentLeftPanel({
  agents,
  expandedIds,
  onToggleAgent,
  onToggleExpandAll,
  onOpenSecrets,
  isOpen,
  onToggleOpen,
  width,
  onResize,
  onResetWidth,
  feedItems,
  onResolvePermission,
  onResolvePlan,
}: {
  agents: FakeAgent[]
  expandedIds: Set<string>
  onToggleAgent: (id: string) => void
  onToggleExpandAll: () => void
  onOpenSecrets: () => void
  isOpen: boolean
  onToggleOpen: () => void
  width: number
  onResize: (delta: number) => void
  onResetWidth: () => void
  feedItems: TeamFeedItem[]
  onResolvePermission: (feedIndex: number, verdict: "allowed" | "denied") => void
  onResolvePlan: (feedIndex: number, verdict: "approved" | "rejected") => void
}) {
  const [panelTab, setPanelTab] = useState<"agents" | "skills">("agents")
  const [searchQuery, setSearchQuery] = useState("")
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [skillsAllExpanded, setSkillsAllExpanded] = useState(false)

  const totalCost = useMemo(() => agents.reduce((sum, a) => sum + a.cost, 0), [agents])

  const filteredAgents = useMemo(() => {
    let result = agents
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(a => a.name.toLowerCase().includes(q))
    }
    if (tagFilter) {
      result = result.filter(a => a.tags.includes(tagFilter))
    }
    return result
  }, [agents, searchQuery, tagFilter])

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  /* ---- Collapsed state: 48px icon rail ---- */
  if (!isOpen) {
    return (
      <aside className="group/rail w-12 h-full bg-surface-sunken border-r-[0.5px] border-border-default flex flex-col shrink-0 relative">
        {/* Hover edge hint — subtle accent line on right edge */}
        <div className="absolute top-0 bottom-0 right-0 w-px bg-transparent group-hover/rail:bg-accent/25 transition-colors" />

        {/* Project icon + secrets + cost */}
        <div className="pt-3 pb-1 flex flex-col items-center gap-1.5">
          <div className="h-6 w-6 rounded-md bg-accent/15 flex items-center justify-center text-[11px] font-bold text-accent">
            A
          </div>
          <button
            type="button"
            onClick={onOpenSecrets}
            className="p-1 rounded-md text-muted/50 hover:text-secondary hover:bg-surface-raised/50 transition-colors"
            title="Project secrets"
          >
            <KeyRound className="h-3 w-3" />
          </button>
          <span className="text-[8px] text-muted/50 font-mono tabular-nums">
            {formatCost(totalCost)}
          </span>
        </div>

        {/* Expand button */}
        <div className="flex justify-center pb-1.5 border-b border-border-subtle mb-1">
          <button
            type="button"
            onClick={onToggleOpen}
            className="p-1 rounded-md text-muted/40 hover:text-accent hover:bg-accent/10 transition-colors"
            title="Expand panel"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Agent avatars */}
        <div className="flex-1 flex flex-col items-center gap-1.5 py-2 overflow-y-auto">
          {agents.map((agent) => {
            const config = LIFECYCLE_CONFIG[agent.lifecycleStatus]
            const isSelected = expandedIds.has(agent.id)
            const isRunning = agent.lifecycleStatus === "running"
            const isStopped = agent.lifecycleStatus === "stopped"
            const hasAttention = agent.attentionLevel !== "none"
            const attCfg = hasAttention ? ATTENTION_CONFIG[agent.attentionLevel as Exclude<AttentionLevel, "none">] : null

            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  if (!expandedIds.has(agent.id)) onToggleAgent(agent.id)
                  onToggleOpen()
                }}
                className={cn(
                  "relative group",
                  isStopped && "opacity-55",
                )}
                title={agent.name}
              >
                <AgentAvatar name={agent.name} size="md" stopped={isStopped} />
                {/* Attention dot takes precedence over lifecycle dot */}
                {hasAttention && attCfg ? (
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface-sunken",
                      attCfg.dot,
                      attCfg.pulse && "animate-breathe",
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface-sunken",
                      config.dot,
                      isRunning && "animate-breathe text-success",
                    )}
                  />
                )}
                {isSelected && (
                  <span className="absolute inset-0 rounded-md ring-2 ring-accent/50" />
                )}
              </button>
            )
          })}
        </div>

        {/* Bottom: user avatar */}
        <div className="py-3 flex flex-col items-center border-t border-border-default">
          <div
            className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent cursor-pointer hover:ring-2 hover:ring-accent/30 transition-shadow"
            title="vahid"
          >
            V
          </div>
        </div>
      </aside>
    )
  }

  /* ---- Open state: resizable panel ---- */
  return (
    <aside
      className="relative h-full bg-surface border-r border-border-default flex flex-col shrink-0"
      style={{ width, minWidth: width }}
    >
      <ResizeHandle onResize={onResize} onReset={onResetWidth} side="right" />

      {/* Project selector + secrets + cost */}
      <div className="h-10 px-3 flex items-center border-b border-border-default shrink-0">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-1 py-1 -ml-1 rounded-md hover:bg-surface-sunken/40 transition-colors min-w-0"
        >
          <div className="h-6 w-6 rounded-md bg-accent/15 flex items-center justify-center text-[11px] font-bold text-accent shrink-0">
            A
          </div>
          <span className="text-sm font-medium text-default truncate">agentobox</span>
          <ChevronRight size={12} className="text-muted/40 rotate-90 shrink-0" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenSecrets}
          className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
          title="Project secrets"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] text-muted/60 font-mono tabular-nums mx-1 shrink-0">
          {formatCost(totalCost)}
        </span>
        <button
          type="button"
          onClick={onToggleOpen}
          className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
          title="Collapse panel"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Panel tabs: Agents | Skills */}
      <div className="h-7 px-3 flex items-center gap-1 border-b border-border-default shrink-0">
        <button
          type="button"
          onClick={() => setPanelTab("agents")}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
            panelTab === "agents"
              ? "bg-surface-raised text-default"
              : "text-muted hover:text-secondary hover:bg-surface-raised/30",
          )}
        >
          <Users className="h-3 w-3" />
          Agents
        </button>
        <button
          type="button"
          onClick={() => setPanelTab("skills")}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
            panelTab === "skills"
              ? "bg-surface-raised text-default"
              : "text-muted hover:text-secondary hover:bg-surface-raised/30",
          )}
        >
          <BookOpen className="h-3 w-3" />
          Skills
        </button>
        <span className="flex-1" />
        {panelTab === "agents" ? (
          <button
            type="button"
            onClick={onToggleExpandAll}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
            title="Cycle card states"
          >
            {expandedIds.size > 0 ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSkillsAllExpanded(p => !p)}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
            title={skillsAllExpanded ? "Collapse all" : "Expand all"}
          >
            {skillsAllExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Tab content */}
      {panelTab === "agents" ? (
        <>
          {/* Agent filter bar */}
          <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
            <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded-md border border-border-default bg-surface-sunken/40 px-2 py-1">
              <Search className="h-3 w-3 text-muted/50 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
              />
            </div>
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowTagDropdown(!showTagDropdown)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
                  tagFilter
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
                )}
              >
                <Filter className="h-3 w-3" />
                {tagFilter || "Tags"}
                <ChevronRight size={10} className="rotate-90 text-muted/40" />
              </button>
              {showTagDropdown && (
                <div className="absolute top-full right-0 mt-1 w-32 rounded-md border border-border-default bg-surface-raised shadow-lg z-(--z-dropdown) overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setTagFilter(null); setShowTagDropdown(false) }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-[11px] transition-colors",
                      !tagFilter ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                    )}
                  >
                    All tags
                  </button>
                  {ALL_TAGS.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => { setTagFilter(tag); setShowTagDropdown(false) }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors",
                        tagFilter === tag ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors shrink-0",
                selectMode
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
              )}
            >
              <CheckSquare className="h-3 w-3" />
              {selectMode ? "Done" : "Select"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 text-muted hover:text-secondary hover:bg-surface-raised/50"
            >
              <Plus className="h-3 w-3" />
              Create
            </button>
          </div>

          {/* Agent cards */}
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="p-3 space-y-2">
              {filteredAgents.map((agent) => (
                <AgentCardRow
                  key={agent.id}
                  agent={agent}
                  isOpen={!selectMode && expandedIds.has(agent.id)}
                  onToggle={() => selectMode ? handleSelectAgent(agent.id) : onToggleAgent(agent.id)}
                  selectable={selectMode}
                  selected={selectedIds.has(agent.id)}
                  onSelect={() => handleSelectAgent(agent.id)}
                  pendingItems={getPendingItemsForAgent(feedItems, agent.name)}
                  onResolvePermission={onResolvePermission}
                  onResolvePlan={onResolvePlan}
                />
              ))}
              {filteredAgents.length === 0 && (
                <div className="py-6 text-center">
                  <Users className="h-5 w-5 text-muted/20 mx-auto mb-1" />
                  <p className="text-[11px] text-muted/50">No agents match filters</p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Bulk action bar — when in select mode */}
          {selectMode && (
            <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-sunken/30 flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (selectedIds.size === filteredAgents.length) {
                    setSelectedIds(new Set())
                  } else {
                    setSelectedIds(new Set(filteredAgents.map(a => a.id)))
                  }
                }}
                className="text-[11px] text-accent hover:text-accent-hover transition-colors shrink-0"
              >
                {selectedIds.size === filteredAgents.length ? "Deselect all" : "Select all"}
              </button>
              <span className="text-[11px] font-medium text-default shrink-0">
                {selectedIds.size} selected
              </span>
              <select
                className="bg-surface-sunken/60 border border-border-default rounded-md px-2 py-1 text-[11px] text-secondary outline-none"
                defaultValue=""
                onChange={() => {}}
              >
                <option value="" disabled>Assign skill...</option>
                {SKILLS.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <select
                className="bg-surface-sunken/60 border border-border-default rounded-md px-2 py-1 text-[11px] text-secondary outline-none"
                defaultValue=""
                onChange={() => {}}
              >
                <option value="" disabled>Set model...</option>
                <option>Opus 4.6</option>
                <option>Sonnet 4.6</option>
                <option>Haiku 4.5</option>
              </select>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-[11px] text-muted hover:text-secondary transition-colors"
              >
                Clear
              </button>
            </div>
          )}

        </>
      ) : (
        <SkillsPanel allExpanded={skillsAllExpanded} />
      )}

      {/* Bottom: user avatar */}
      <div className="px-3 py-2 border-t border-border-default flex items-center shrink-0">
        <div
          className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent cursor-pointer hover:ring-2 hover:ring-accent/30 transition-shadow"
          title="vahid"
        >
          V
        </div>
      </div>
    </aside>
  )
}

/* ================================================================== */
/*  RECIPIENT SEARCH — dark search box for @agent / #tag               */
/* ================================================================== */

/** Max pills to show before collapsing to "+N" */
const MAX_VISIBLE_PILLS = 6

function recipientLabel(r: RecipientEntry): string {
  return r.type === "all" ? "@all" : r.type === "agent" ? `@${r.value}` : `#${r.value}`
}

function recipientKey(r: RecipientEntry): string {
  return r.type === "all" ? "all" : `${r.type}-${r.value}`
}

function RecipientSearchBox({
  agents,
  allTags,
  recipients,
  onAddRecipient,
  onRemoveRecipient,
  onSuggestionsChange,
}: {
  agents: FakeAgent[]
  allTags: string[]
  recipients: RecipientEntry[]
  onAddRecipient: (entry: RecipientEntry) => void
  onRemoveRecipient: (index: number) => void
  onSuggestionsChange?: (suggestions: RecipientEntry[]) => void
}) {
  const [inputValue, setInputValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)

  // Ghost suggestion — includes @all as a special option
  const ghost = useMemo(() => {
    if (!inputValue) return null
    if (inputValue.startsWith("@")) {
      const partial = inputValue.slice(1).toLowerCase()
      if (!partial) return null
      if ("all".startsWith(partial) && "all" !== partial) return "all".slice(partial.length)
      if ("all" === partial) return null
      const match = agents.find(a => a.name.toLowerCase().startsWith(partial))
      if (match && match.name.toLowerCase() !== partial) return match.name.slice(partial.length)
      if (match && match.name.toLowerCase() === partial) return null
    }
    if (inputValue.startsWith("#")) {
      const partial = inputValue.slice(1).toLowerCase()
      if (!partial) return null
      const match = allTags.find(t => t.toLowerCase().startsWith(partial))
      if (match && match.toLowerCase() !== partial) return match.slice(partial.length)
      if (match && match.toLowerCase() === partial) return null
    }
    return null
  }, [inputValue, agents, allTags])

  const isCompleteMatch = useMemo(() => {
    if (inputValue.startsWith("@")) {
      const name = inputValue.slice(1).toLowerCase()
      if (name === "all") return true
      return agents.some(a => a.name.toLowerCase() === name)
    }
    if (inputValue.startsWith("#")) {
      const tag = inputValue.slice(1).toLowerCase()
      return allTags.some(t => t.toLowerCase() === tag)
    }
    return false
  }, [inputValue, agents, allTags])

  const commitInput = useCallback(() => {
    if (inputValue.startsWith("@")) {
      const name = inputValue.slice(1).toLowerCase()
      if (name === "all") { onAddRecipient({ type: "all" }); setInputValue(""); return true }
      const match = agents.find(a => a.name.toLowerCase() === name)
      if (match) { onAddRecipient({ type: "agent", value: match.name }); setInputValue(""); return true }
    }
    if (inputValue.startsWith("#")) {
      const tag = inputValue.slice(1).toLowerCase()
      const match = allTags.find(t => t.toLowerCase() === tag)
      if (match) { onAddRecipient({ type: "tag", value: match }); setInputValue(""); return true }
    }
    return false
  }, [inputValue, agents, allTags, onAddRecipient])

  const acceptGhost = useCallback(() => {
    if (!ghost) return false
    setInputValue(prev => prev + ghost)
    return true
  }, [ghost])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === "Tab" || e.key === "ArrowRight") && ghost) {
      e.preventDefault()
      acceptGhost()
      return
    }
    if ((e.key === "Enter" || e.key === " ") && isCompleteMatch) {
      e.preventDefault()
      commitInput()
      return
    }
    if (e.key === "Backspace" && inputValue === "" && recipients.length > 0) {
      e.preventDefault()
      onRemoveRecipient(recipients.length - 1)
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setInputValue("")
    }
  }, [ghost, isCompleteMatch, inputValue, recipients.length, acceptGhost, commitInput, onRemoveRecipient])

  // Autocomplete suggestions
  const suggestions = useMemo((): RecipientEntry[] => {
    if (!inputValue) return []
    if (inputValue.startsWith("@")) {
      const partial = inputValue.slice(1).toLowerCase()
      const results: RecipientEntry[] = []
      if (!partial || "all".startsWith(partial)) {
        if (!recipients.some(r => r.type === "all")) results.push({ type: "all" })
      }
      agents
        .filter(a => !partial || a.name.toLowerCase().startsWith(partial))
        .filter(a => !recipients.some(r => r.type === "agent" && r.value === a.name))
        .slice(0, 6)
        .forEach(a => results.push({ type: "agent", value: a.name }))
      return results
    }
    if (inputValue.startsWith("#")) {
      const partial = inputValue.slice(1).toLowerCase()
      return allTags
        .filter(t => !partial || t.toLowerCase().startsWith(partial))
        .filter(t => !recipients.some(r => r.type === "tag" && r.value === t))
        .slice(0, 6)
        .map(t => ({ type: "tag", value: t }))
    }
    return []
  }, [inputValue, agents, allTags, recipients])

  useEffect(() => {
    onSuggestionsChange?.(suggestions)
  }, [suggestions, onSuggestionsChange])

  return (
    <div className="min-w-0">
      {/* Dark search input */}
      <div className="relative flex items-center min-w-0 rounded-md border border-border-subtle/50 bg-surface-sunken/30 px-2 py-0.5 w-36">
        <span
          ref={measureRef}
          className="invisible absolute whitespace-pre text-[11px] font-mono"
          aria-hidden
        >
          {inputValue}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="@agent or #tag"
          className="bg-transparent border-none outline-none text-[11px] font-mono text-default placeholder:text-muted/30 w-full min-w-0"
        />
        {ghost && (
          <span
            className="absolute pointer-events-none text-[11px] font-mono text-muted/25 whitespace-pre"
            style={{ left: `calc(0.5rem + ${measureRef.current?.offsetWidth ?? 0}px)` }}
          >
            {ghost}
          </span>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  COMPOSER BAR                                                       */
/* ================================================================== */

function ComposerBar({
  recipients,
  agents,
  allTags,
  onAddRecipient,
  onRemoveRecipient,
}: {
  recipients: RecipientEntry[]
  agents: FakeAgent[]
  allTags: string[]
  onAddRecipient: (entry: RecipientEntry) => void
  onRemoveRecipient: (index: number) => void
}) {
  const [suggestions, setSuggestions] = useState<RecipientEntry[]>([])

  const handleSuggestionsChange = useCallback((s: RecipientEntry[]) => {
    setSuggestions(s)
  }, [])

  const placeholderName = recipients.length === 0
    ? "your team"
    : recipients.length === 1
      ? recipients[0].type === "all" ? "all agents" : recipients[0].type === "agent" ? recipients[0].value : `#${recipients[0].value}`
      : `${recipients.length} recipients`
  const placeholder = `Message ${placeholderName}...`

  const visiblePills = recipients.slice(0, MAX_VISIBLE_PILLS)
  const overflowCount = Math.max(0, recipients.length - MAX_VISIBLE_PILLS)

  // Dont show committed pills when just the default @team-lead
  const isDefault = recipients.length === 1 && recipients[0].type === "agent" && recipients[0].value === "team-lead"

  const hasPillContent = (!isDefault && recipients.length > 0) || suggestions.length > 0

  return (
    <div className="px-6 pb-4 pt-2 max-w-3xl mx-auto w-full shrink-0">
      {/* Composer box */}
      <div className="relative rounded-2xl border-[0.5px] border-border-default bg-surface-raised/60 focus-within:bg-surface-raised focus-within:border-border-default">
        {/* Text input — auto-grows up to ~6 rows then scrolls */}
        <textarea
          placeholder={placeholder}
          rows={1}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = "auto"
            el.style.height = `${el.scrollHeight}px`
          }}
          className="w-full bg-transparent border-none outline-none resize-none px-4 pt-4 pb-2 text-sm text-default placeholder:text-muted min-h-[52px] max-h-[200px] overflow-y-auto"
        />

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-3 pb-3 gap-2">
          {/* Left side */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              disabled
              className="rounded-lg p-1.5 text-muted cursor-not-allowed opacity-50 shrink-0"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <RecipientSearchBox
              agents={agents}
              allTags={allTags}
              recipients={recipients}
              onAddRecipient={onAddRecipient}
              onRemoveRecipient={onRemoveRecipient}
              onSuggestionsChange={handleSuggestionsChange}
            />
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted font-mono tabular-nums">$0.30</span>
            <button
              type="button"
              className="flex items-center justify-center h-8 w-8 rounded-full bg-surface-sunken text-muted cursor-not-allowed"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      {/* Pills row — underneath the composer box */}
      <div className="flex items-center gap-1.5 px-1 pt-2 min-w-0 overflow-x-auto no-scrollbar min-h-[28px]">
        {/* Committed pills */}
        {!isDefault && visiblePills.map((r, i) => (
          <span
            key={recipientKey(r)}
            className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full bg-surface-sunken text-[10px] font-mono text-secondary shrink-0"
          >
            {recipientLabel(r)}
            <button
              type="button"
              onClick={() => onRemoveRecipient(i)}
              className="text-muted/40 hover:text-muted transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {!isDefault && overflowCount > 0 && (
          <span className="text-[10px] text-muted font-mono shrink-0">+{overflowCount}</span>
        )}
        {/* Autocomplete suggestions inline */}
        {suggestions.map(s => (
          <button
            key={`sug-${recipientKey(s)}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAddRecipient(s)}
            className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono bg-surface-sunken/50 text-muted hover:bg-surface-sunken hover:text-secondary transition-colors border border-border-subtle/50"
          >
            {recipientLabel(s)}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  PINNED ITEM CARD — shows pending plan/permission at feed top       */
/* ================================================================== */

/* ================================================================== */
/*  ATTENTION BAR                                                      */
/* ================================================================== */

function AttentionBar({
  feedItems,
  focusedAgentId,
  agents,
  onResolvePermission,
  onResolvePlan,
  onReviewAgent,
}: {
  feedItems: TeamFeedItem[]
  focusedAgentId: string | null
  agents: FakeAgent[]
  onResolvePermission: (feedIndex: number, verdict: "allowed" | "denied") => void
  onResolvePlan: (feedIndex: number, verdict: "approved" | "rejected") => void
  onReviewAgent: (agentName: string) => void
}) {
  // Collect pending items with their original feed index for resolution
  const pending: { item: PendingItem; feedIndex: number; agentId?: string }[] = []
  feedItems.forEach((item, i) => {
    if (item.type === "permission" && item.permStatus === "pending") {
      const agent = agents.find(a => a.name === item.agent)
      pending.push({ item: item as PendingItem, feedIndex: i, agentId: agent?.id })
    }
    if (item.type === "plan" && item.planStatus === "pending") {
      const agent = agents.find(a => a.name === item.agent)
      pending.push({ item: item as PendingItem, feedIndex: i, agentId: agent?.id })
    }
  })

  // Expanded plan review state
  const [expandedFeedIndex, setExpandedFeedIndex] = useState<number | null>(null)
  const expandedPlan = expandedFeedIndex !== null
    ? pending.find(p => p.feedIndex === expandedFeedIndex && p.item.type === "plan")
    : null

  if (pending.length === 0) return null

  // Sort: permissions first, then plans
  const sorted = [...pending].sort((a, b) => {
    const order = { permission: 0, plan: 1 }
    return (order[a.item.type] ?? 2) - (order[b.item.type] ?? 2)
  })

  // Stepper state — clamp to valid range when items resolve
  const [stepIdx, setStepIdx] = useState(0)
  const clamped = Math.min(stepIdx, sorted.length - 1)
  const current = sorted[clamped]
  const { item, feedIndex, agentId } = current
  const isFocused = focusedAgentId != null && agentId === focusedAgentId
  const hasPrev = clamped > 0
  const hasNext = clamped < sorted.length - 1

  const handleReview = (agentName: string, fi: number) => {
    onReviewAgent(agentName)
    setExpandedFeedIndex(fi)
  }

  const handleResolvePlanAndCollapse = (fi: number, verdict: "approved" | "rejected") => {
    onResolvePlan(fi, verdict)
    setExpandedFeedIndex(null)
  }

  // Expanded view — the card IS the attention bar
  if (expandedPlan && expandedPlan.item.type === "plan") {
    return (
      <div className="px-6 mb-2 max-w-3xl mx-auto w-full">
        <div className="rounded-lg border border-warning/20 bg-warning-subtle/10 overflow-hidden flex flex-col">
          {/* Header: agent label + stepper + close */}
          <div className="px-3.5 pt-3 pb-2 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-[11px] text-warning font-mono">{expandedPlan.item.agent} · Proposing a plan</span>
            <span className="flex-1" />
            {sorted.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => { setStepIdx(clamped - 1); setExpandedFeedIndex(null) }}
                  className={cn(
                    "p-0.5 rounded transition-colors",
                    hasPrev ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
                  )}
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="text-[10px] text-muted tabular-nums font-mono">
                  {clamped + 1}/{sorted.length}
                </span>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => { setStepIdx(clamped + 1); setExpandedFeedIndex(null) }}
                  className={cn(
                    "p-0.5 rounded transition-colors",
                    hasNext ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
                  )}
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setExpandedFeedIndex(null)}
              className="p-0.5 rounded text-muted hover:text-default hover:bg-surface-raised/50 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* Title */}
          <div className="px-3.5 pb-2">
            <p className="text-[13px] font-medium text-default leading-snug">{expandedPlan.item.title}</p>
          </div>

          {/* Scrollable markdown body */}
          <div className="border-t border-border-subtle/50 px-3.5 py-3 max-h-[35vh] overflow-y-auto">
            <MarkdownRenderer
              content={expandedPlan.item.plan}
              className="text-xs text-secondary [&_h2]:text-[11px] [&_h2]:font-mono [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-muted [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:first:mt-0 [&_ol]:space-y-1 [&_ul]:space-y-0.5 [&_li]:text-xs [&_li]:leading-relaxed [&_code]:text-[10px] [&_code]:bg-surface-sunken/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_p]:leading-relaxed [&_p]:mb-1.5"
            />
          </div>

          {/* Pinned footer — always visible */}
          <div className="border-t border-border-subtle/50 px-3.5 py-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleResolvePlanAndCollapse(expandedPlan.feedIndex, "approved")}
              className="px-3 py-1.5 rounded-md border border-success/30 text-xs font-medium text-success hover:bg-success-subtle/40 transition-colors"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => handleResolvePlanAndCollapse(expandedPlan.feedIndex, "rejected")}
              className="px-3 py-1.5 rounded-md border border-danger/30 text-xs font-medium text-danger hover:bg-danger-subtle/40 transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Collapsed compact bar
  return (
    <div className="px-6 mb-2 max-w-3xl mx-auto w-full"><div className="rounded-lg border border-warning/20 bg-warning-subtle/10 p-3">
      {/* Header: icon + count + stepper nav */}
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
        <span className="text-xs font-medium text-warning">
          {sorted.length} item{sorted.length !== 1 ? "s" : ""} need attention
        </span>
        {sorted.length > 1 && (
          <>
            <span className="flex-1" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => setStepIdx(clamped - 1)}
                className={cn(
                  "p-0.5 rounded transition-colors",
                  hasPrev ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
                )}
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="text-[10px] text-muted tabular-nums font-mono">
                {clamped + 1}/{sorted.length}
              </span>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => setStepIdx(clamped + 1)}
                className={cn(
                  "p-0.5 rounded transition-colors",
                  hasNext ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
                )}
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Current item */}
      <div className={cn("flex items-center gap-2 min-w-0", isFocused && "opacity-50")}>
        <AgentAvatar name={item.agent} size="sm" />
        <span className="text-[11px] text-secondary truncate flex-1 min-w-0">
          {item.type === "permission"
            ? `${item.agent} wants to run: ${item.command}`
            : `${item.agent} proposed: ${item.title}`}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {item.type === "permission" ? (
            <>
              <button
                type="button"
                onClick={() => onResolvePermission(feedIndex, "allowed")}
                className="px-2 py-1 rounded text-[10px] font-medium text-success border border-success/30 hover:bg-success-subtle/40 transition-colors"
              >
                Allow
              </button>
              <button
                type="button"
                onClick={() => onResolvePermission(feedIndex, "denied")}
                className="px-2 py-1 rounded text-[10px] font-medium text-danger border border-danger/30 hover:bg-danger-subtle/40 transition-colors"
              >
                Deny
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleReview(item.agent, feedIndex)}
              className="px-2 py-1 rounded text-[10px] font-medium text-warning border border-warning/30 hover:bg-warning-subtle/40 transition-colors inline-flex items-center gap-1"
            >
              Review <ChevronRight className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>
    </div></div>
  )
}

/** Get the agent name from a feed item (if it has one) */
function getFeedItemAgent(item: TeamFeedItem): string | null {
  switch (item.type) {
    case "summary":
    case "status":
    case "error":
    case "question":
    case "plan":
    case "permission":
    case "multi-question":
      return item.agent
    case "agent-message":
      return item.from // primary agent is sender; filtering handled separately
    case "user":
      return item.target ?? null
    case "system":
      return null
  }
}

/* ================================================================== */
/*  TEAM FEED — main feed renders team-level events only               */
/*                                                                     */
/*  This is the "slack channel" view. You see:                         */
/*  - Your messages to agents (@mentions + broadcasts)                 */
/*  - Agent summaries when they complete a turn                        */
/*  - Status transitions (started, errored, stopped)                   */
/*  - Error alerts (actionable)                                        */
/*  - AskUserQuestion cards (agent needs input)                        */
/*  - System messages (session lifecycle)                               */
/*                                                                     */
/*  You do NOT see: tool calls, thinking, intermediate assistant        */
/*  messages, tool results. Those live in the right panel detail view. */
/* ================================================================== */

function TeamFeed({
  feedItems,
  agentFilter,
  onClickAgent,
}: {
  feedItems: TeamFeedItem[]
  agentFilter?: Set<string>
  onClickAgent?: (agentName: string) => void
}) {
  const filtered = useMemo(() => {
    let items = feedItems
    // Filter by agent
    if (agentFilter && agentFilter.size > 0) {
      items = items.filter(item => {
        const agent = getFeedItemAgent(item)
        // System messages pass through when filtering (context)
        if (item.type === "system") return true
        // User messages targeted to a filtered agent pass through
        if (item.type === "user" && item.target && agentFilter.has(item.target)) return true
        // User messages without target pass through (broadcasts)
        if (item.type === "user" && !item.target) return true
        // Agent-to-agent messages pass if either participant matches
        if (item.type === "agent-message") return agentFilter.has(item.from) || agentFilter.has(item.to)
        // Agent items pass if agent matches
        return agent !== null && agentFilter.has(agent)
      })
    }
    return items
  }, [feedItems, agentFilter])

  return (
    <ScrollArea className="flex-1 overflow-y-auto dotted-grid">
      <div className="max-w-3xl mx-auto w-full px-6 py-4 space-y-3">
        {filtered.map((item, i) => {
          switch (item.type) {
            case "system":
              return <SystemMessage key={i} text={item.text} />
            case "user":
              return <TeamUserMessage key={i} text={item.text} target={item.target} />
            case "summary":
              return (
                <AgentSummaryCard
                  key={i}
                  agent={item.agent}
                  summary={item.summary}
                  cost={item.cost}
                  turns={item.turns}
                  duration={item.duration}
                  isError={item.isError}
                  onClickAgent={onClickAgent}
                />
              )
            case "status":
              return <AgentStatusLine key={i} agent={item.agent} from={item.from} to={item.to} onClickAgent={onClickAgent} />
            case "error":
              return <TeamErrorAlert key={i} agent={item.agent} text={item.text} onClickAgent={onClickAgent} />
            case "question":
              return <QuestionCard key={i} agent={item.agent} question={item.question} options={item.options} />
            case "plan":
              return <PlanCard key={i} agent={item.agent} title={item.title} plan={item.plan} planStatus={item.planStatus} />
            case "permission":
              return <PermissionCard key={i} agent={item.agent} command={item.command} risk={item.risk} permStatus={item.permStatus} />
            case "multi-question":
              return <MultiQuestionCard key={i} agent={item.agent} questions={item.questions} />
            case "agent-message":
              return <AgentToAgentMessage key={i} from={item.from} to={item.to} text={item.text} onClickAgent={onClickAgent} />
            default:
              return null
          }
        })}
      </div>
    </ScrollArea>
  )
}


/* ================================================================== */
/*  AGENT CARDS + VNC PANEL (unified)                                  */
/* ================================================================== */

/** VNC thumbnail placeholder — aspect ratio matches a 16:10 display */
function VncThumbnail({ agent }: { agent: FakeAgent }) {
  const isRunning = agent.lifecycleStatus === "running"
  const isStopped = agent.lifecycleStatus === "stopped"

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden bg-surface-sunken/40 flex flex-col",
        isRunning ? "border-border-default" : "border-border-subtle",
        isStopped && "opacity-50",
      )}
    >
      {/* VNC viewport — 16:10 aspect ratio */}
      <div className="relative w-full" style={{ aspectRatio: "16 / 10" }}>
        {/* Simulated desktop content */}
        <div className="absolute inset-0 flex flex-col">
          {/* Fake title bar */}
          <div className="h-4 bg-[hsl(220_10%_13%)] flex items-center px-2 gap-1 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-danger/60" />
            <span className="h-1.5 w-1.5 rounded-full bg-warning/60" />
            <span className="h-1.5 w-1.5 rounded-full bg-success/60" />
            <span className="ml-2 text-[7px] text-muted/40 font-mono truncate">
              {agent.name} — {isRunning ? agent.task : isStopped ? "session ended" : agent.lifecycleStatus}
            </span>
          </div>
          {/* Fake terminal content */}
          <div className="flex-1 bg-[hsl(220_12%_10%)] p-1.5 overflow-hidden">
            {isRunning ? (
              <div className="space-y-0.5">
                <p className="text-[6px] font-mono text-success/50 leading-tight">$ claude</p>
                <p className="text-[6px] font-mono text-muted/30 leading-tight truncate">{agent.lastOutput}</p>
                <p className="text-[6px] font-mono text-accent/40 leading-tight">
                  <span className="animate-pulse">▊</span>
                </p>
              </div>
            ) : isStopped ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-[7px] font-mono text-muted/20">session ended</span>
              </div>
            ) : agent.lifecycleStatus === "error" ? (
              <div className="space-y-0.5">
                <p className="text-[6px] font-mono text-danger/50 leading-tight">Error: {agent.task}</p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <span className="text-[7px] font-mono text-muted/25">{agent.lifecycleStatus}</span>
              </div>
            )}
          </div>
        </div>

        {/* Live indicator overlay */}
        {isRunning && (
          <div className="absolute top-1 right-1 inline-flex items-center gap-1 rounded bg-black/50 px-1 py-px">
            <span className="h-1 w-1 rounded-full bg-success animate-breathe text-success" />
            <span className="text-[6px] text-success font-mono">live</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  TAG INPUT — reusable inline tag editor with autocomplete           */
/* ================================================================== */

function TagInput({
  tags,
  onChange,
  placeholder = "Add tag...",
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState("")

  const addTag = (tag: string) => {
    const normalized = tag.toLowerCase().replace(/[^a-z0-9-]/g, "")
    if (normalized && !tags.includes(normalized)) {
      onChange([...tags, normalized])
    }
    setInput("")
  }

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-mono text-accent"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="ml-0.5 text-accent/50 hover:text-accent transition-colors"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && input.trim()) {
            e.preventDefault()
            addTag(input.trim())
          }
          if (e.key === "Backspace" && !input && tags.length > 0) {
            removeTag(tags[tags.length - 1])
          }
        }}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-[11px] font-mono text-default placeholder:text-muted/40"
      />
    </div>
  )
}

/* ================================================================== */
/*  AGENT SETTINGS PANEL — config form inside expanded card            */
/* ================================================================== */

function AgentSettingsPanel({ agent }: { agent: FakeAgent }) {
  const [model, setModel] = useState(agent.model)
  const [instructions, setInstructions] = useState(agent.instructions)
  const [agentTags, setAgentTags] = useState(agent.tags)
  const dirty = model !== agent.model || instructions !== agent.instructions || JSON.stringify(agentTags) !== JSON.stringify(agent.tags)

  return (
    <div className="px-3 py-3 space-y-3">
      {/* Model selector */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          Model
        </label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs text-default outline-none focus:border-accent/50 transition-colors"
        >
          <option>Opus 4.6</option>
          <option>Sonnet 4.6</option>
          <option>Haiku 4.5</option>
        </select>
      </div>

      {/* Instructions textarea */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          Instructions
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default outline-none focus:border-accent/50 transition-colors resize-none"
        />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          Tags
        </label>
        <div className="bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 focus-within:border-accent/50 transition-colors">
          <TagInput tags={agentTags} onChange={setAgentTags} placeholder="Add tag..." />
        </div>
      </div>

      {/* MCP Servers */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          MCP Servers
        </label>
        {agent.mcpServers.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {agent.mcpServers.map((server) => (
              <span
                key={server}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-sunken/60 border border-border-subtle text-[11px] font-mono text-secondary"
              >
                {server}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-muted/50 font-mono">none configured</span>
        )}
      </div>

      {/* Info line */}
      <div className="text-[10px] text-muted font-mono">
        Runtime: {agent.runtime} · Workspace: {agent.workspacePath}
      </div>

      {/* Restart banner */}
      {dirty && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-warning-subtle/30 border border-warning/20">
          <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
          <span className="text-[11px] text-warning">Changes require restart</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-accent/30 text-[11px] text-accent font-medium hover:bg-accent/10 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Restart
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-default text-[11px] text-secondary font-medium hover:bg-surface-sunken/40 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Redeploy
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-danger/30 text-[11px] text-danger font-medium hover:bg-danger-subtle/40 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
          Remove
        </button>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  AGENT SKILLS VIEW — per-agent skills in card view                  */
/* ================================================================== */

function AgentSkillsView({ agent }: { agent: FakeAgent }) {
  const skills = getAgentSkills(agent)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  return (
    <div className="px-3 py-3 space-y-3">
      {/* Agent tags */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
          Tags
        </label>
        {agent.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {agent.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-mono text-accent"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-muted/50 font-mono">no tags</span>
        )}
      </div>

      {/* Inherited skills */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
          Inherited Skills
        </label>
        {skills.length === 0 ? (
          <div className="py-4 text-center rounded-md border border-border-subtle bg-surface-sunken/20">
            <BookOpen className="h-5 w-5 text-muted/20 mx-auto mb-1" />
            <p className="text-[11px] text-muted/50">No skills assigned via tags</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {skills.map((skill) => {
              const isExpanded = expandedSkill === skill.id
              const sourceTag = skill.assignedTags.find(t => agent.tags.includes(t))
              return (
                <div key={skill.id} className="rounded-md border border-border-subtle overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                    className="w-full text-left px-2.5 py-2 flex items-center gap-2 hover:bg-surface-sunken/30 transition-colors"
                  >
                    <ChevronRight
                      size={12}
                      className={cn(
                        "shrink-0 text-muted transition-transform duration-(--duration-normal)",
                        isExpanded && "rotate-90",
                      )}
                    />
                    <span className="text-xs font-medium text-default flex-1 min-w-0 truncate">
                      {skill.name}
                    </span>
                    {sourceTag && (
                      <span className="text-[9px] font-mono text-muted/60 shrink-0">
                        via {sourceTag}
                      </span>
                    )}
                    {skill.steps && (
                      <span className="text-[9px] font-mono text-info/60 shrink-0">
                        {skill.steps} steps
                      </span>
                    )}
                  </button>
                  <Collapsible open={isExpanded}>
                    <div className="px-2.5 pb-2.5 border-t border-border-subtle">
                      <MarkdownRenderer
                        content={skill.content}
                        className="text-xs text-secondary"
                      />
                    </div>
                  </Collapsible>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

type ViewMode = "terminal" | "feed" | "settings" | "skills"

/**
 * Agent card — two states:
 *
 * COLLAPSED — compact single row:
 *   avatar | name | status dot | live action | cost · time | chevron
 *
 * OPEN — content area + bottom toolbar:
 *   header row → content (VNC / feed / settings) → toolbar (view icons + composer + todo)
 */
function AgentCardRow({
  agent,
  isOpen,
  onToggle,
  selectable = false,
  selected = false,
  onSelect,
  pendingItems = [],
  onResolvePermission,
  onResolvePlan,
}: {
  agent: FakeAgent
  isOpen: boolean
  onToggle: () => void
  selectable?: boolean
  selected?: boolean
  onSelect?: () => void
  pendingItems?: PendingItem[]
  onResolvePermission?: (index: number, verdict: "allowed" | "denied") => void
  onResolvePlan?: (index: number, verdict: "approved" | "rejected") => void
}) {
  const config = LIFECYCLE_CONFIG[agent.lifecycleStatus]
  const isRunning = agent.lifecycleStatus === "running"
  const isError = agent.lifecycleStatus === "error"
  const isStopped = agent.lifecycleStatus === "stopped"
  const [viewMode, setViewMode] = useState<ViewMode>("terminal")
  const [agentMode, setAgentMode] = useState(agent.mode)

  const hasAttention = agent.attentionLevel !== "none"
  const attCfg = hasAttention ? ATTENTION_CONFIG[agent.attentionLevel as Exclude<AttentionLevel, "none">] : null
  const hasPendingItem = pendingItems.length > 0

  const VIEW_MODES: { id: ViewMode; icon: typeof Monitor; label: string }[] = [
    { id: "terminal", icon: Monitor, label: "Screen" },
    { id: "feed", icon: List, label: "Feed" },
    { id: "skills", icon: BookOpen, label: "Skills" },
    { id: "settings", icon: Settings, label: "Settings" },
  ]

  return (
    <div
      className={cn(
        "rounded-lg border transition-all duration-(--duration-normal)",
        isOpen
          ? cn("border-accent/40 bg-surface-raised/80 shadow-sm", isError && "border-danger/40")
          : cn(
              "border-border-subtle bg-surface hover:bg-surface-raised/40 hover:border-border-default",
              isError && "border-danger/30 hover:border-danger/40",
              isStopped && "opacity-60",
            ),
      )}
    >
      {/* Header row — div instead of button to allow nested interactive ModePill */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (selectable && onSelect) {
            onSelect()
          } else {
            onToggle()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            if (selectable && onSelect) onSelect()
            else onToggle()
          }
        }}
        className="w-full text-left px-2.5 py-2 cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectable && (
            <div
              className={cn(
                "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                selected
                  ? "bg-accent/20 border-accent/50"
                  : "border-border-default",
              )}
            >
              {selected && <Check className="h-2.5 w-2.5 text-accent" strokeWidth={3} />}
            </div>
          )}
          <div className="relative shrink-0">
            <AgentAvatar name={agent.name} size="sm" stopped={isStopped} />
            {/* Attention dot overlay on avatar — takes precedence over lifecycle */}
            {hasAttention && attCfg && (
              <span
                className={cn(
                  "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface",
                  attCfg.dot,
                  attCfg.pulse && "animate-breathe",
                )}
              />
            )}
          </div>
          <span
            className={cn(
              "text-[12px] font-medium shrink-0",
              isStopped ? "text-muted" : "text-default",
            )}
          >
            {agent.name}
          </span>
          <ModePill mode={agentMode} onChange={setAgentMode} />
          {/* Tag pills — show 1 + overflow count, shrink before mode */}
          {agent.tags.length > 0 && (
            <span className="inline-flex items-center gap-1 shrink min-w-0 overflow-hidden">
              <span className="px-1.5 py-px rounded text-[9px] font-mono text-muted bg-surface-sunken/60 border border-border-subtle truncate">
                {agent.tags[0]}
              </span>
              {agent.tags.length > 1 && (
                <span className="text-[9px] text-muted/40 font-mono shrink-0">+{agent.tags.length - 1}</span>
              )}
            </span>
          )}
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              config.dot,
              isRunning && "animate-breathe text-success",
            )}
          />

          {/* Live action one-liner */}
          {agent.liveAction ? (
            <span className="text-[10px] text-muted font-mono truncate flex-1 min-w-0">
              {agent.liveAction}
            </span>
          ) : (
            <span className="text-[10px] text-muted/50 font-mono truncate flex-1 min-w-0">
              {agent.task}
            </span>
          )}

          {/* Right: cost · time + chevron */}
          <span className="text-[9px] text-muted/60 font-mono tabular-nums shrink-0">
            {formatCost(agent.cost)} · {agent.duration}
          </span>
          <ChevronRight
            size={14}
            className={cn(
              "shrink-0 text-muted transition-transform duration-(--duration-normal)",
              isOpen && "rotate-90",
            )}
          />
        </div>
      </div>

      {/* Open content — animated reveal */}
      <Collapsible open={isOpen}>
        {/* Content area — fixed height set by VNC aspect ratio, other views scroll */}
        <div className="px-3 pb-2 aspect-[16/11] overflow-y-auto">
          {viewMode === "terminal" && <VncThumbnail agent={agent} />}
          {viewMode === "feed" && <AgentDetailFeed agent={agent} />}
          {viewMode === "skills" && <AgentSkillsView agent={agent} />}
          {viewMode === "settings" && <AgentSettingsPanel agent={agent} />}
        </div>

        {/* Action strip — slides in above composer when agent has pending items */}
        {hasPendingItem && (
          <div className="border-t border-warning/20 bg-warning-subtle/10 px-3 py-1.5">
            {pendingItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2 min-w-0">
                <Shield className="h-3 w-3 text-warning shrink-0" />
                <span className="text-[11px] text-warning font-medium truncate flex-1 min-w-0">
                  {item.type === "permission"
                    ? item.command
                    : `Plan: ${item.title}`}
                </span>
                {item.type === "permission" ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onResolvePermission?.(i, "allowed")}
                      className="px-2 py-0.5 rounded text-[10px] font-medium text-success border border-success/30 hover:bg-success-subtle/40 transition-colors"
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolvePermission?.(i, "denied")}
                      className="px-2 py-0.5 rounded text-[10px] font-medium text-danger border border-danger/30 hover:bg-danger-subtle/40 transition-colors"
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolvePermission?.(i, "allowed")}
                      className="px-2 py-0.5 rounded text-[10px] font-medium text-muted border border-border-subtle hover:bg-surface-raised/40 transition-colors"
                      title="Allow and don't ask again for this tool"
                    >
                      Always
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onResolvePlan?.(i, "approved")}
                      className="px-2 py-0.5 rounded text-[10px] font-medium text-success border border-success/30 hover:bg-success-subtle/40 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolvePlan?.(i, "rejected")}
                      className="px-2 py-0.5 rounded text-[10px] font-medium text-danger border border-danger/30 hover:bg-danger-subtle/40 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Bottom toolbar — always present: view icons + composer + todo */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-border-subtle bg-surface-sunken/20">
          {/* View mode icons */}
          <div className="flex items-center gap-0.5 shrink-0">
            {VIEW_MODES.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                className={cn(
                  "p-1 rounded transition-colors",
                  viewMode === id
                    ? "bg-surface-raised text-default"
                    : "text-muted/50 hover:text-secondary hover:bg-surface-raised/40",
                )}
                title={label}
              >
                <Icon className="h-3 w-3" />
              </button>
            ))}
          </div>

          {/* Mini composer */}
          <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded border border-border-default bg-surface-sunken/40 px-2 py-1">
            <span className="text-[9px] text-accent font-mono shrink-0">@{agent.name}</span>
            <input
              type="text"
              placeholder="Message..."
              className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
            />
            <button
              type="button"
              className="flex items-center justify-center h-4 w-4 rounded-full bg-surface text-muted shrink-0"
            >
              <ArrowUp className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          </div>

          {/* Todo progress */}
          {agent.todoProgress && (
            <span className="flex items-center gap-1 shrink-0">
              <CheckSquare className="h-3 w-3 text-muted/50" />
              <span className="text-[9px] font-mono text-muted tabular-nums">
                {agent.todoProgress.done}/{agent.todoProgress.total}
              </span>
            </span>
          )}
        </div>
      </Collapsible>
    </div>
  )
}

/**
 * Agent detail mini-feed — shows VERBOSE output for a single agent.
 * This is the drill-in view. Content comes from TimelineEntry.content
 * (full content blocks), NOT from the summary field.
 *
 * SOURCE: TimelineEntry.content — tool_use blocks, assistant text,
 *   thinking blocks, tool_result blocks. Everything the team feed hides.
 */
function AgentDetailFeed({ agent }: { agent: FakeAgent }) {
  const isRunning = agent.lifecycleStatus === "running"
  const isError = agent.lifecycleStatus === "error"

  return (
    <div className="border-t border-border-subtle flex flex-col">


      {/* Historical content only — scrollable mini-feed */}
      <div className="flex-1 min-h-0 max-h-[320px] overflow-y-auto px-3 py-2 space-y-2">
        {agent.name === "backend" ? (
          <>
            {/* Tool calls (source: tool_use content blocks) */}
            <SingleToolRow toolName="Read" summary="src/auth.ts" />
            <SingleToolRow toolName="Read" summary="src/middleware/auth.ts" />

            {/* Assistant message (source: text content blocks) */}
            <AssistantMessage
              agent={agent.name}
              content={FAKE_MARKDOWN}
              showAvatar={false}
            />

            {/* More tool calls */}
            <MultiToolGroup
              tools={[
                { name: "Edit", summary: "src/auth.ts — fix validateToken()" },
                { name: "Edit", summary: "src/middleware/auth.ts — reorder handlers" },
                { name: "Bash", summary: "npm run lint" },
              ]}
            />

            <AssistantMessage
              agent={agent.name}
              content="Applied the fix and ran the linter. All clean."
              showAvatar={false}
            />

            {/* Result pill (source: result message) */}
            <ResultPill cost={agent.cost} duration={agent.duration} turns={agent.turns} model={agent.model} />
          </>
        ) : agent.name === "qa" ? (
          <>
            <SingleToolRow toolName="Bash" summary="npm test -- --filter auth" />
            {isError ? (
              <ErrorBubble
                agent={agent.name}
                text={"FAIL src/auth.test.ts\n\nExpected: 200\nReceived: 401\n\nThe refresh endpoint middleware ordering is wrong."}
              />
            ) : (
              <>
                <AssistantMessage
                  agent={agent.name}
                  content="Running the full auth test suite. 47 tests found."
                  showAvatar={false}
                />
                <ResultPill cost={agent.cost} duration={agent.duration} turns={agent.turns} model={agent.model} />
              </>
            )}
          </>
        ) : agent.name === "frontend" ? (
          <>
            <SingleToolRow toolName="Read" summary="src/components/Button.tsx" />
            <SingleToolRow toolName="Read" summary="src/styles/tokens.css" />
            <AssistantMessage
              agent={agent.name}
              content="Scanning Tailwind classes in Button, Card, and Input components..."
              showAvatar={false}
            />
          </>
        ) : agent.name === "docs" ? (
          <>
            <SingleToolRow toolName="Read" summary="docs/api-reference.md" />
            <MultiToolGroup
              tools={[
                { name: "Edit", summary: "docs/api-reference.md — add rotation docs" },
                { name: "Edit", summary: "docs/auth-flow.md — update diagram" },
              ]}
            />
            <AssistantMessage
              agent={agent.name}
              content="Updated API reference with refresh token rotation documentation and migration notes."
              showAvatar={false}
            />
            <ResultPill cost={agent.cost} duration={agent.duration} turns={agent.turns} model={agent.model} />
          </>
        ) : (
          /* Generic fallback for devops, infra, etc. */
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-muted/50 font-mono">
              {agent.lifecycleStatus === "deploying" ? "Initializing workspace..." : "No activity yet"}
            </span>
          </div>
        )}
      </div>

    </div>
  )
}

/* ================================================================== */
/*  SKILLS PANEL — skills tab content in left panel                    */
/* ================================================================== */

function SkillsPanel({ allExpanded, onToggleExpandAll }: { allExpanded: boolean; onToggleExpandAll?: () => void }) {
  const [search, setSearch] = useState("")
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newContent, setNewContent] = useState("")
  const [newTags, setNewTags] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [skillTagFilter, setSkillTagFilter] = useState<string | null>(null)
  const [showSkillTagDropdown, setShowSkillTagDropdown] = useState(false)

  const allSkillTags = useMemo(() => Array.from(new Set(SKILLS.flatMap(s => s.assignedTags))).sort(), [])

  const filtered = useMemo(() => {
    let result = SKILLS
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      )
    }
    if (skillTagFilter) {
      result = result.filter(s => s.assignedTags.includes(skillTagFilter))
    }
    return result
  }, [search, skillTagFilter])

  return (
    <div className="flex flex-col h-full">
      {/* Search + create */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
        <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded-md border border-border-default bg-surface-sunken/40 px-2 py-1">
          <Search className="h-3 w-3 text-muted/50 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
          />
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowSkillTagDropdown(!showSkillTagDropdown)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
              skillTagFilter
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
            )}
          >
            <Filter className="h-3 w-3" />
            {skillTagFilter || "Tags"}
            <ChevronRight size={10} className="rotate-90 text-muted/40" />
          </button>
          {showSkillTagDropdown && (
            <div className="absolute top-full right-0 mt-1 w-32 rounded-md border border-border-default bg-surface-raised shadow-lg z-(--z-dropdown) overflow-hidden">
              <button
                type="button"
                onClick={() => { setSkillTagFilter(null); setShowSkillTagDropdown(false) }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-[11px] transition-colors",
                  !skillTagFilter ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                )}
              >
                All tags
              </button>
              {allSkillTags.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => { setSkillTagFilter(tag); setShowSkillTagDropdown(false) }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors",
                    skillTagFilter === tag ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (selectMode) {
              setSelectMode(false)
              setSelectedSkills(new Set())
            } else {
              setSelectMode(true)
            }
          }}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors shrink-0",
            selectMode
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
          )}
        >
          <CheckSquare className="h-3 w-3" />
          {selectMode ? "Done" : "Select"}
        </button>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0",
            showCreate
              ? "bg-accent/15 text-accent"
              : "text-muted hover:text-secondary hover:bg-surface-raised/50",
          )}
        >
          <Plus className="h-3 w-3" />
          Create
        </button>
        {onToggleExpandAll && (
          <button
            type="button"
            onClick={onToggleExpandAll}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
            title={allExpanded ? "Collapse all" : "Expand all"}
          >
            {allExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Create form */}
      <Collapsible open={showCreate}>
        <div className="px-3 py-2 border-b border-border-subtle space-y-2 bg-surface-sunken/20">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Skill name..."
            className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Markdown content..."
            rows={4}
            className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors resize-none"
          />
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
              Assign to tags
            </label>
            <div className="bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 focus-within:border-accent/50 transition-colors">
              <TagInput tags={newTags} onChange={setNewTags} placeholder="Add tag..." />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!newName.trim()}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                newName.trim()
                  ? "bg-accent text-on-emphasis hover:bg-accent-hover"
                  : "bg-surface-sunken text-muted cursor-not-allowed",
              )}
            >
              Save
            </button>
          </div>
        </div>
      </Collapsible>

      {/* Skills list */}
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <BookOpen className="h-6 w-6 text-muted/20 mx-auto mb-1.5" />
              <p className="text-[11px] text-muted/50">No skills found</p>
            </div>
          ) : (
            filtered.map((skill) => {
              const isExpanded = !selectMode && (allExpanded || expandedSkills.has(skill.id))
              const isSelected = selectedSkills.has(skill.id)
              return (
                <div key={skill.id} className={cn(
                  "rounded-lg border overflow-hidden",
                  selectMode && isSelected ? "border-accent/40" : "border-border-subtle",
                )}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectMode) {
                        setSelectedSkills(prev => {
                          const next = new Set(prev)
                          if (next.has(skill.id)) next.delete(skill.id)
                          else next.add(skill.id)
                          return next
                        })
                      } else {
                        setExpandedSkills(prev => {
                          const next = new Set(prev)
                          if (next.has(skill.id)) next.delete(skill.id)
                          else next.add(skill.id)
                          return next
                        })
                      }
                    }}
                    className="w-full text-left px-2.5 py-2 hover:bg-surface-raised/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {selectMode ? (
                        <div
                          className={cn(
                            "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                            isSelected
                              ? "bg-accent/20 border-accent/50"
                              : "border-border-default",
                          )}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5 text-accent" strokeWidth={3} />}
                        </div>
                      ) : (
                        <ChevronRight
                          size={12}
                          className={cn(
                            "shrink-0 text-muted transition-transform duration-(--duration-normal)",
                            isExpanded && "rotate-90",
                          )}
                        />
                      )}
                      <span className="text-xs font-medium text-default flex-1 min-w-0 truncate">
                        {skill.name}
                      </span>
                      {skill.steps ? (
                        <span className="text-[9px] font-mono text-info/60 shrink-0">
                          {skill.steps} steps
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-muted/40 shrink-0">
                          skill
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 ml-5">
                      {skill.assignedTags.map((tag) => (
                        <span key={tag} className="px-1.5 py-px rounded text-[9px] font-mono text-accent/70 bg-accent/8 border border-accent/15">
                          {tag}
                        </span>
                      ))}
                      <span className="text-[9px] text-muted/40 font-mono">
                        {skill.description.length > 40 ? skill.description.slice(0, 40) + "..." : skill.description}
                      </span>
                    </div>
                  </button>
                  <Collapsible open={isExpanded}>
                    <div className="px-3 pb-3 border-t border-border-subtle bg-surface-sunken/10">
                      <MarkdownRenderer
                        content={skill.content}
                        className="text-xs text-secondary"
                      />
                    </div>
                  </Collapsible>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      {/* Bulk action bar for skills */}
      {selectMode && (
        <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-sunken/30 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (selectedSkills.size === filtered.length) {
                setSelectedSkills(new Set())
              } else {
                setSelectedSkills(new Set(filtered.map(s => s.id)))
              }
            }}
            className="text-[11px] text-accent hover:text-accent-hover transition-colors shrink-0"
          >
            {selectedSkills.size === filtered.length ? "Deselect all" : "Select all"}
          </button>
          <span className="text-[11px] text-muted shrink-0">
            {selectedSkills.size} selected
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
              selectedSkills.size > 0
                ? "text-danger hover:bg-danger-subtle/40"
                : "text-muted cursor-not-allowed",
            )}
            disabled={selectedSkills.size === 0}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function AgentCardsPanel({
  agents,
  expandedIds,
  onToggleAgent,
  onToggleExpandAll,
  feedItems,
  onResolvePermission,
  onResolvePlan,
}: {
  agents: FakeAgent[]
  expandedIds: Set<string>
  onToggleAgent: (id: string) => void
  onToggleExpandAll?: () => void
  feedItems?: TeamFeedItem[]
  onResolvePermission?: (feedIndex: number, verdict: "allowed" | "denied") => void
  onResolvePlan?: (feedIndex: number, verdict: "approved" | "rejected") => void
}) {
  const [searchQuery, setSearchQuery] = useState("")
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filteredAgents = useMemo(() => {
    let result = agents
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(a => a.name.toLowerCase().includes(q) || a.tags.some(t => t.includes(q)))
    }
    if (tagFilter) {
      result = result.filter(a => a.tags.includes(tagFilter))
    }
    return result
  }, [agents, searchQuery, tagFilter])

  const handleSelectAgent = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  return (
    <>
      {/* Toolbar: search + tags + select + create + expand */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
        <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded-md border border-border-default bg-surface-sunken/40 px-2 py-1">
          <Search className="h-3 w-3 text-muted/50 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents..."
            className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
          />
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowTagDropdown(!showTagDropdown)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
              tagFilter
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
            )}
          >
            <Filter className="h-3 w-3" />
            {tagFilter || "Tags"}
            <ChevronRight size={10} className="rotate-90 text-muted/40" />
          </button>
          {showTagDropdown && (
            <div className="absolute top-full right-0 mt-1 w-32 rounded-md border border-border-default bg-surface-raised shadow-lg z-(--z-dropdown) overflow-hidden">
              <button
                type="button"
                onClick={() => { setTagFilter(null); setShowTagDropdown(false) }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-[11px] transition-colors",
                  !tagFilter ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                )}
              >
                All tags
              </button>
              {ALL_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => { setTagFilter(tag); setShowTagDropdown(false) }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors",
                    tagFilter === tag ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors shrink-0",
            selectMode
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
          )}
        >
          <CheckSquare className="h-3 w-3" />
          {selectMode ? "Done" : "Select"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 text-muted hover:text-secondary hover:bg-surface-raised/50"
        >
          <Plus className="h-3 w-3" />
          Create
        </button>
        {onToggleExpandAll && (
          <button
            type="button"
            onClick={onToggleExpandAll}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
            title="Cycle card states"
          >
            {expandedIds.size > 0 ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Agent cards */}
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2">
          {filteredAgents.map((agent) => (
            <AgentCardRow
              key={agent.id}
              agent={agent}
              isOpen={!selectMode && expandedIds.has(agent.id)}
              onToggle={() => selectMode ? handleSelectAgent(agent.id) : onToggleAgent(agent.id)}
              selectable={selectMode}
              selected={selectedIds.has(agent.id)}
              onSelect={() => handleSelectAgent(agent.id)}
              pendingItems={feedItems ? getPendingItemsForAgent(feedItems, agent.name) : []}
              onResolvePermission={onResolvePermission}
              onResolvePlan={onResolvePlan}
            />
          ))}
          {filteredAgents.length === 0 && (
            <div className="py-6 text-center">
              <Users className="h-5 w-5 text-muted/20 mx-auto mb-1" />
              <p className="text-[11px] text-muted/50">No agents match filters</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  )
}

/* ================================================================== */
/*  TAB BAR                                                            */
/* ================================================================== */

function TabBar({
  tabs,
  activeTab,
  onTabChange,
  badges,
}: {
  tabs: { id: string; label: string; icon: React.ReactNode }[]
  activeTab: string
  onTabChange: (id: string) => void
  badges?: Record<string, number>
}) {
  return (
    <div role="tablist" className="h-8 flex items-center gap-1 px-3 border-b border-border-default bg-surface shrink-0">
      {tabs.map((tab) => {
        const badge = badges?.[tab.id] ?? 0
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "bg-surface-raised text-default"
                : "text-muted hover:text-secondary hover:bg-surface-raised/30",
            )}
          >
            {tab.icon}
            {tab.label}
            {badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-danger text-[8px] font-bold text-on-emphasis flex items-center justify-center">
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ================================================================== */
/*  BREAKPOINT INDICATOR                                               */
/* ================================================================== */

function BreakpointIndicator({ bp }: { bp: Breakpoint }) {
  const labels: Record<Breakpoint, { text: string; width: string }> = {
    XL: { text: "XL", width: "\u22651920" },
    L: { text: "L", width: "1440-1919" },
    M: { text: "M", width: "1280-1439" },
    S: { text: "S", width: "1024-1279" },
    mobile: { text: "Mobile", width: "<1024" },
  }

  const info = labels[bp]

  return (
    <div className="fixed bottom-4 right-4 z-(--z-toast) inline-flex items-center gap-1.5 rounded-full bg-surface-overlay border border-border-default shadow-lg px-3 py-1.5">
      <span className="h-2 w-2 rounded-full bg-accent" />
      <span className="text-[11px] font-semibold text-default">{info.text}</span>
      <span className="text-[10px] text-muted font-mono">{info.width}px</span>
    </div>
  )
}

/* ================================================================== */
/*  PANEL HEADER (shared between Agent Activity + Screen)              */
/* ================================================================== */

function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-8 px-3 flex items-center border-b border-border-default shrink-0">
      {children}
    </div>
  )
}

/* ================================================================== */
/*  RESIZE HANDLE                                                      */
/* ================================================================== */

/** Drag handle for resizable panels. Place on the leading edge of the panel. */
function ResizeHandle({
  onResize,
  onReset,
  side = "left",
}: {
  onResize: (delta: number) => void
  onReset?: () => void
  side?: "left" | "right"
}) {
  const lastX = useRef(0)
  const [active, setActive] = useState(false)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      lastX.current = e.clientX
      setActive(true)
      document.documentElement.classList.add("dragging-resize")
      const move = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX.current
        lastX.current = ev.clientX
        onResize(side === "left" ? -delta : delta)
      }
      const up = () => {
        setActive(false)
        document.documentElement.classList.remove("dragging-resize")
        document.removeEventListener("mousemove", move)
        document.removeEventListener("mouseup", up)
      }
      document.addEventListener("mousemove", move)
      document.addEventListener("mouseup", up)
    },
    [onResize, side],
  )

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      className={cn(
        "absolute top-0 bottom-0 w-3 z-(--z-dropdown) hover:cursor-col-resize",
        side === "left" ? "-left-1.5" : "-right-1.5",
      )}
    >
      <div className={cn(
        "absolute inset-y-0 w-0.5 transition-colors",
        active ? "bg-accent/50" : "bg-transparent",
        side === "left" ? "left-1.5" : "right-1.5",
      )} />
    </div>
  )
}

/* ================================================================== */
/*  MAIN PAGE                                                          */
/* ================================================================== */

export default function PrototypePage() {
  const bp = useBreakpoint()
  const [agents, dispatchAgent] = useReducer(agentReducer, INITIAL_AGENTS)
  const [feedItems, setFeedItems] = useState<TeamFeedItem[]>(TEAM_FEED)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(["1"]))
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>("1")
  const [mainTab, setMainTab] = useState<"chat" | "agents" | "skills">("chat")
  const [secretsOpen, setSecretsOpen] = useState(false)
  const [mobileSkillsExpanded, setMobileSkillsExpanded] = useState(false)
  const [recipients, setRecipients] = useState<RecipientEntry[]>([{ type: "agent", value: "team-lead" }])
  const [agentPanelOpen, setAgentPanelOpen] = useState(() => bp !== "S" && bp !== "mobile")
  const [leftPanelWidth, setLeftPanelWidth] = useState<number | null>(null)

  // Reset custom panel width on breakpoint change (keep open/closed state as-is)
  useEffect(() => {
    setLeftPanelWidth(null)
  }, [bp])

  const handleToggleAgent = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // Track focused agent + acknowledge review on expand
    setFocusedAgentId(id)
    dispatchAgent({ type: "ACKNOWLEDGE", agentId: id })
  }, [])

  const handleToggleExpandAll = useCallback(() => {
    setExpandedIds((prev) => {
      const allOpen = agents.every((a) => prev.has(a.id))
      if (allOpen) return new Set()
      return new Set(agents.map((a) => a.id))
    })
  }, [agents])

  // Resolve a permission feed item → update feed + recompute agent attention
  const handleResolvePermission = useCallback((feedIndex: number, verdict: "allowed" | "denied") => {
    setFeedItems(prev => {
      const next = [...prev]
      const item = next[feedIndex]
      if (item.type === "permission") {
        next[feedIndex] = { ...item, permStatus: verdict }
        // Recompute attention for this agent
        const agentName = item.agent
        const newAttention = deriveAttentionFromFeed(next, agentName)
        dispatchAgent({ type: "SET_ATTENTION", agentId: agents.find(a => a.name === agentName)?.id ?? "", level: newAttention })
      }
      return next
    })
  }, [agents])

  // Resolve a plan feed item → update feed + recompute agent attention
  const handleResolvePlan = useCallback((feedIndex: number, verdict: "approved" | "rejected") => {
    setFeedItems(prev => {
      const next = [...prev]
      const item = next[feedIndex]
      if (item.type === "plan") {
        next[feedIndex] = { ...item, planStatus: verdict }
        const agentName = item.agent
        const newAttention = deriveAttentionFromFeed(next, agentName)
        dispatchAgent({ type: "SET_ATTENTION", agentId: agents.find(a => a.name === agentName)?.id ?? "", level: newAttention })
      }
      return next
    })
  }, [agents])

  // Attention badge count for small-screen tab bar
  const pendingCount = useMemo(() => getAllPendingItems(feedItems).length, [feedItems])

  // Expand recipients to flat set of agent names (tags resolve to their agents)
  // Default (@team-lead) and @all = no filter (empty set means all pass through)
  const isDefaultRecipient = recipients.length === 1 && recipients[0].type === "agent" && recipients[0].value === "team-lead"
  const effectiveAgentFilter = useMemo(() => {
    if (isDefaultRecipient) return new Set<string>()
    if (recipients.some(r => r.type === "all")) return new Set<string>()
    if (recipients.length === 0) return new Set<string>()
    const names = new Set<string>()
    for (const r of recipients) {
      if (r.type === "agent") names.add(r.value)
      else if (r.type === "tag") for (const a of agents) { if (a.tags.includes(r.value)) names.add(a.name) }
    }
    return names
  }, [recipients, agents, isDefaultRecipient])

  const singleFilteredAgent = useMemo(() =>
    effectiveAgentFilter.size === 1 ? Array.from(effectiveAgentFilter)[0] : null
  , [effectiveAgentFilter])

  // Recipient handlers
  const defaultRecipient: RecipientEntry = { type: "agent", value: "team-lead" }

  const handleAddRecipient = useCallback((entry: RecipientEntry) => {
    setRecipients(prev => {
      // @all replaces everything
      if (entry.type === "all") return [entry]
      // Adding a specific recipient removes @all
      const without = prev.filter(r => r.type !== "all")
      const entryKey = `${entry.type}:${"value" in entry ? entry.value : ""}`
      const isDupe = without.some(r => `${r.type}:${"value" in r ? r.value : ""}` === entryKey)
      if (isDupe) return without
      return [...without, entry]
    })
  }, [])

  const handleRemoveRecipient = useCallback((index: number) => {
    setRecipients(prev => {
      const next = prev.filter((_, i) => i !== index)
      // If removing last recipient, reset to default
      if (next.length === 0) return [defaultRecipient]
      return next
    })
  }, [])

  const handleReviewAgent = useCallback((agentName: string) => {
    setRecipients([{ type: "agent", value: agentName }])
    setMainTab("chat")
  }, [])

  // Click agent avatar in feed → set recipient to that agent
  const handleFeedClickAgent = useCallback((agentName: string) => {
    setRecipients([{ type: "agent", value: agentName }])
    setMainTab("chat")
  }, [])

  // Determine what's visible at each breakpoint
  const showTopTabs = bp === "mobile"
  const showLeftPanel = bp !== "mobile"

  // Left panel width: scale with screen, collapse threshold = 25% of viewport
  const screenWidth = typeof window !== "undefined" ? window.innerWidth : 1920
  const collapseThreshold = Math.round(screenWidth * 0.2)
  const minPanelWidth = collapseThreshold + 20
  const defaultLeftWidth = bp === "S" ? Math.max(minPanelWidth, 320) : bp === "M" ? Math.max(minPanelWidth, 340) : 480
  const effectiveLeftWidth = leftPanelWidth ?? defaultLeftWidth

  const handleLeftPanelResize = useCallback((delta: number) => {
    setLeftPanelWidth((prev) => {
      const current = prev ?? defaultLeftWidth
      const next = current + delta
      if (next < collapseThreshold) {
        setAgentPanelOpen(false)
        return null
      }
      return Math.max(minPanelWidth, Math.min(720, next))
    })
  }, [defaultLeftWidth, collapseThreshold, minPanelWidth])

  // When re-expanding, set width above collapse threshold to prevent insta-collapse
  const handleTogglePanelOpen = useCallback(() => {
    setAgentPanelOpen(prev => {
      if (!prev) {
        // expanding — ensure width is safely above collapse threshold
        setLeftPanelWidth(cur => {
          const w = cur ?? defaultLeftWidth
          return Math.max(w, collapseThreshold + 40)
        })
      }
      return !prev
    })
  }, [defaultLeftWidth, collapseThreshold])

  // Top tabs (small screens)
  const topTabs = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: "agents", label: "Agents", icon: <Users className="h-3.5 w-3.5" /> },
    { id: "skills", label: "Skills", icon: <BookOpen className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="h-screen flex bg-surface overflow-hidden cursor-default">
      <h1 className="sr-only">Agentobox Dashboard</h1>

      {/* Secrets modal */}
      <SecretsModal
        open={secretsOpen}
        onClose={() => setSecretsOpen(false)}
        agents={agents}
      />

      {/* Left panel: collapsed icon rail or open agent cards */}
      {showLeftPanel && (
        <AgentLeftPanel
          agents={agents}
          expandedIds={expandedIds}
          onToggleAgent={handleToggleAgent}
          onToggleExpandAll={handleToggleExpandAll}
          onOpenSecrets={() => setSecretsOpen(true)}
          isOpen={agentPanelOpen}
          onToggleOpen={handleTogglePanelOpen}
          width={effectiveLeftWidth}
          onResize={handleLeftPanelResize}
          onResetWidth={() => setLeftPanelWidth(null)}
          feedItems={feedItems}
          onResolvePermission={handleResolvePermission}
          onResolvePlan={handleResolvePlan}
        />
      )}

      {/* Right side: tabs (on small) + team feed */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Mobile header: project + secrets + user (replaces sidebar header/footer) */}
        {bp === "mobile" && (
          <div className="h-10 px-3 flex items-center border-b border-border-default bg-surface shrink-0">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-1 py-1 -ml-1 rounded-md hover:bg-surface-sunken/40 transition-colors min-w-0"
            >
              <div className="h-6 w-6 rounded-md bg-accent/15 flex items-center justify-center text-[11px] font-bold text-accent shrink-0">
                A
              </div>
              <span className="text-sm font-medium text-default truncate">agentobox</span>
              <ChevronRight size={12} className="text-muted/40 rotate-90 shrink-0" />
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setSecretsOpen(true)}
              className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
              title="Project secrets"
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
            <span className="text-[10px] text-muted/60 font-mono tabular-nums mx-1.5">
              {formatCost(agents.reduce((s, a) => s + a.cost, 0))}
            </span>
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent"
              title="vahid"
            >
              V
            </div>
          </div>
        )}

        {/* Top tabs (S + mobile) */}
        {showTopTabs && (
          <TabBar
            tabs={topTabs}
            activeTab={mainTab}
            onTabChange={(id) => setMainTab(id as "chat" | "agents" | "skills")}
            badges={pendingCount > 0 ? { chat: pendingCount } : undefined}
          />
        )}

        {/* Center: team feed + attention bar + composer */}
        {(!showTopTabs || mainTab === "chat") && (
          <main className="flex-1 min-w-0 flex flex-col min-h-0">
            <TeamFeed
              feedItems={feedItems}
              agentFilter={effectiveAgentFilter}
              onClickAgent={handleFeedClickAgent}
            />
            <AttentionBar
              feedItems={feedItems}
              focusedAgentId={focusedAgentId}
              agents={agents}
              onResolvePermission={handleResolvePermission}
              onResolvePlan={handleResolvePlan}
              onReviewAgent={handleReviewAgent}
            />
            <ComposerBar
              recipients={recipients}
              agents={agents}
              allTags={ALL_TAGS}
              onAddRecipient={handleAddRecipient}
              onRemoveRecipient={handleRemoveRecipient}
            />
          </main>
        )}

        {/* Top-tab content: agents (S + mobile) */}
        {showTopTabs && mainTab === "agents" && (
          <div className="flex-1 min-w-0 bg-surface flex flex-col overflow-hidden">
            <AgentCardsPanel
              agents={agents}
              expandedIds={expandedIds}
              onToggleAgent={handleToggleAgent}
              onToggleExpandAll={handleToggleExpandAll}
              feedItems={feedItems}
              onResolvePermission={handleResolvePermission}
              onResolvePlan={handleResolvePlan}
            />
            <AttentionBar
              feedItems={feedItems}
              focusedAgentId={focusedAgentId}
              agents={agents}
              onResolvePermission={handleResolvePermission}
              onResolvePlan={handleResolvePlan}
              onReviewAgent={handleReviewAgent}
            />
          </div>
        )}

        {/* Top-tab content: skills (S + mobile) */}
        {showTopTabs && mainTab === "skills" && (
          <div className="flex-1 min-w-0 bg-surface overflow-hidden flex flex-col">
            <SkillsPanel allExpanded={mobileSkillsExpanded} onToggleExpandAll={() => setMobileSkillsExpanded(p => !p)} />
            <AttentionBar
              feedItems={feedItems}
              focusedAgentId={focusedAgentId}
              agents={agents}
              onResolvePermission={handleResolvePermission}
              onResolvePlan={handleResolvePlan}
              onReviewAgent={handleReviewAgent}
            />
          </div>
        )}
      </div>

      {/* Breakpoint indicator */}
      <BreakpointIndicator bp={bp} />
    </div>
  )
}
