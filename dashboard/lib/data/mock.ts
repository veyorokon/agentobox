import type { Agent, Secret, Skill, TeamFeedItem } from "@/lib/types"

/* ================================================================== */
/*  AGENTS                                                             */
/* ================================================================== */

export const MOCK_AGENTS: Agent[] = [
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

/* ================================================================== */
/*  SECRETS                                                            */
/* ================================================================== */

export const SECRETS: Secret[] = [
  { id: "s1", key: "GITHUB_TOKEN", value: "ghp_a1b2c3d4e5f6g7h8i9j0", addedAgo: "2d ago" },
  { id: "s2", key: "ANTHROPIC_API_KEY", value: "sk-ant-api03-xxxxxxxxxxxx", addedAgo: "5d ago" },
  { id: "s3", key: "AWS_ACCESS_KEY_ID", value: "AKIAIOSFODNN7EXAMPLE", addedAgo: "1w ago" },
  { id: "s4", key: "OPENAI_API_KEY", value: "sk-proj-xxxxxxxxxxxxxxxx", addedAgo: "1w ago" },
]

/* ================================================================== */
/*  SKILLS                                                             */
/* ================================================================== */

export const SKILLS: Skill[] = [
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

/* ================================================================== */
/*  TEAM FEED                                                          */
/* ================================================================== */

export const TEAM_FEED: TeamFeedItem[] = [
  { id: "feed-1", type: "system", text: "session started · Opus 4.6 · 47 tools · 6 agents" },
  { id: "feed-2", type: "user", text: "Fix the JWT validation bug in auth.ts. The token expiry check is off by one hour.", target: "backend" },
  { id: "feed-3", type: "user", text: "Run the test suite after backend finishes and report results.", target: "qa" },
  { id: "feed-4", type: "user", text: "Update the API docs once the fix lands.", target: "docs" },
  { id: "feed-5", type: "status", agent: "backend", from: "idle", to: "running" },
  { id: "feed-6", type: "status", agent: "qa", from: "idle", to: "waiting" },
  { id: "feed-7", type: "status", agent: "docs", from: "idle", to: "running" },
  {
    id: "feed-8",
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
  {
    id: "feed-9",
    type: "summary",
    agent: "backend",
    summary: "Fixed JWT validation — converted Date.now() to seconds, added 30s clock skew tolerance, updated error logging in validateToken()",
    cost: 0.08,
    turns: 5,
    duration: "2m 10s",
  },
  {
    id: "feed-10",
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
  {
    id: "feed-11",
    type: "question",
    agent: "backend",
    question: "Should I also add refresh token rotation while I'm in auth.ts?",
    options: ["Yes, add rotation", "No, just the fix", "Create a separate task for it"],
  },
  { id: "feed-12", type: "user", text: "Yes, add rotation. Good catch." },
  { id: "feed-13", type: "status", agent: "qa", from: "waiting", to: "running" },
  {
    id: "feed-14",
    type: "summary",
    agent: "backend",
    summary: "Added refresh token rotation — tokens now rotate on each refresh, old tokens invalidated after 60s grace period. Updated 3 test fixtures.",
    cost: 0.04,
    turns: 3,
    duration: "1m 12s",
  },
  {
    id: "feed-15",
    type: "error",
    agent: "qa",
    text: "2 assertions failed in auth.test.ts:\n  - Expected 200 on /api/refresh, got 401\n  - Token rotation test expects old format",
  },
  { id: "feed-16", type: "status", agent: "qa", from: "running", to: "error" },
  { id: "feed-17", type: "agent-message", from: "backend", to: "qa", text: "auth endpoints updated — refresh rotation uses new token format now, you may need to update fixtures" },
  { id: "feed-18", type: "user", text: "@backend the refresh endpoint still rejects — check the middleware order", target: "backend" },
  {
    id: "feed-19",
    type: "summary",
    agent: "backend",
    summary: "Fixed middleware ordering — auth middleware now runs after token refresh handler. Updated test fixtures to match new rotation format.",
    cost: 0.04,
    turns: 3,
    duration: "1m 00s",
  },
  { id: "feed-20", type: "status", agent: "qa", from: "error", to: "running" },
  {
    id: "feed-21",
    type: "summary",
    agent: "qa",
    summary: "All 47 tests passing. Auth suite: 12/12 pass. Refresh rotation: 3/3 pass. No regressions detected.",
    cost: 0.05,
    turns: 5,
    duration: "2m 10s",
  },
  { id: "feed-22", type: "agent-message", from: "qa", to: "devops", text: "fix/jwt-validation is green — 47/47 tests pass, safe to deploy" },
  {
    id: "feed-23",
    type: "permission",
    agent: "qa",
    command: "git push origin fix/jwt-validation",
    risk: "Pushes to remote branch",
    permStatus: "pending",
  },
  {
    id: "feed-24",
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
  {
    id: "feed-25",
    type: "summary",
    agent: "docs",
    summary: "Updated API reference — added refresh token rotation docs, updated auth flow diagram, added migration notes for v2 token format.",
    cost: 0.02,
    turns: 2,
    duration: "1m 30s",
  },
  { id: "feed-26", type: "status", agent: "docs", from: "running", to: "stopped" },
  { id: "feed-27", type: "system", text: "3 agents completed · 18 turns · $0.23 total" },
]

/* ================================================================== */
/*  DERIVED CONSTANTS                                                  */
/* ================================================================== */

/** All unique tags across agents */
export const ALL_TAGS = Array.from(new Set(MOCK_AGENTS.flatMap(a => a.tags))).sort()

/** Get skills that match an agent's tags */
export function getAgentSkills(agent: Agent): Skill[] {
  return SKILLS.filter(s => s.assignedTags.some(tag => agent.tags.includes(tag)))
}

/**
 * MOCK_MARKDOWN — used in right-panel agent detail feed.
 * SOURCE: TimelineEntry.content (full assistant message content blocks)
 */
export const MOCK_MARKDOWN = `I've analyzed the JWT validation issue. The problem is in \`validateToken()\` — the expiry comparison uses **seconds** but \`Date.now()\` returns **milliseconds**.

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
