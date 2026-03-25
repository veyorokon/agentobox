/**
 * Seeded mock data for the operator console static mockup.
 * All data is hardcoded — no backend calls.
 */

export type WorkStatus = "active" | "needs-you" | "completed" | "failed" | "queued" | "blocked"
export type ExecutionType = "terminal" | "browser" | "files" | "api"

export type WorkArtifact = {
  path: string
  action: "created" | "modified" | "deleted"
  lines?: number
}

export type WorkTask = {
  id: string
  title: string
  status: "done" | "active" | "pending" | "blocked"
  agent?: string
}

export type Intervention = {
  type: "permission" | "plan" | "question"
  agent: string
  summary: string
  options?: string[]
}

export type WorkItem = {
  id: string
  title: string
  agent: string
  status: WorkStatus
  executionType: ExecutionType
  tasks: WorkTask[]
  cost: number
  elapsed: string
  turns: number
  goal?: string
  intervention?: Intervention
  artifacts: WorkArtifact[]
  terminalOutput?: string[]
  observations?: string[]
}

export const MOCK_WORK_ITEMS: WorkItem[] = [
  {
    id: "W-42",
    title: "Refactor auth middleware",
    agent: "backend",
    status: "active",
    executionType: "terminal",
    elapsed: "4m 12s",
    turns: 8,
    cost: 0.47,
    goal: "Extract JWT validation into shared middleware. Remove duplicate auth checks from individual route handlers.",
    tasks: [
      { id: "t1", title: "Audit existing auth patterns", status: "done", agent: "backend" },
      { id: "t2", title: "Extract shared middleware", status: "done", agent: "backend" },
      { id: "t3", title: "Migrate route handlers", status: "active", agent: "backend" },
      { id: "t4", title: "Add middleware tests", status: "pending" },
      { id: "t5", title: "Remove dead auth code", status: "pending" },
    ],
    artifacts: [
      { path: "backend/middleware/auth.py", action: "created", lines: 84 },
      { path: "backend/routes/agents.py", action: "modified", lines: 12 },
      { path: "backend/routes/projects.py", action: "modified", lines: 8 },
      { path: "backend/tests/test_auth_middleware.py", action: "created", lines: 47 },
    ],
    terminalOutput: [
      "\x1b[2m$ python -m pytest backend/tests/test_auth_middleware.py -v\x1b[0m",
      "",
      "backend/tests/test_auth_middleware.py::test_valid_jwt_passes \x1b[32mPASSED\x1b[0m",
      "backend/tests/test_auth_middleware.py::test_expired_jwt_rejects \x1b[32mPASSED\x1b[0m",
      "backend/tests/test_auth_middleware.py::test_missing_header_401 \x1b[32mPASSED\x1b[0m",
      "",
      "\x1b[32m3 passed\x1b[0m in 0.42s",
      "",
      "\x1b[2m$ Reading backend/routes/projects.py...\x1b[0m",
      "\x1b[2m$ Removing inline auth check (lines 14-28)\x1b[0m",
      "\x1b[2m$ Applying shared middleware decorator\x1b[0m",
      "  @require_auth",
      "  async def list_projects(request):",
      "      ...",
    ],
    observations: [
      "3 route files share identical JWT validation logic",
      "No existing middleware pattern — creating new seam",
      "Test coverage was 0% for auth paths before this work",
    ],
  },
  {
    id: "W-41",
    title: "Deploy staging env",
    agent: "infra",
    status: "needs-you",
    executionType: "terminal",
    elapsed: "1m 48s",
    turns: 3,
    cost: 0.12,
    goal: "Provision staging environment with current dev config. Verify smoke tests pass before promoting.",
    intervention: {
      type: "permission",
      agent: "infra",
      summary: "docker compose up -d --remove-orphans",
      options: ["Allow", "Deny"],
    },
    tasks: [
      { id: "t1", title: "Render staging .env", status: "done", agent: "infra" },
      { id: "t2", title: "Run docker compose", status: "blocked", agent: "infra" },
      { id: "t3", title: "Verify smoke tests", status: "pending" },
    ],
    artifacts: [
      { path: ".deploy.env", action: "created", lines: 34 },
    ],
    terminalOutput: [
      "\x1b[2m$ Rendering .deploy.env from config...\x1b[0m",
      "  Wrote 34 vars to .deploy.env",
      "",
      "\x1b[33m⚠ Permission required:\x1b[0m",
      "  docker compose up -d --remove-orphans",
      "",
      "\x1b[2mWaiting for operator approval...\x1b[0m",
    ],
    observations: [
      "Staging DB migrations pending (2 unapplied)",
      "Last staging deploy: 3 days ago",
    ],
  },
  {
    id: "W-40",
    title: "Add integration tests for feed API",
    agent: "test-runner",
    status: "completed",
    executionType: "terminal",
    elapsed: "2m 31s",
    turns: 12,
    cost: 0.31,
    goal: "Cover the feed query and mutation resolvers with integration tests using real DB fixtures.",
    tasks: [
      { id: "t1", title: "Create test fixtures", status: "done", agent: "test-runner" },
      { id: "t2", title: "Test feed query resolver", status: "done", agent: "test-runner" },
      { id: "t3", title: "Test feed mutation resolver", status: "done", agent: "test-runner" },
      { id: "t4", title: "Test permission filtering", status: "done", agent: "test-runner" },
      { id: "t5", title: "Verify CI passes", status: "done", agent: "test-runner" },
    ],
    artifacts: [
      { path: "backend/tests/test_feed_resolvers.py", action: "created", lines: 186 },
      { path: "backend/tests/conftest.py", action: "modified", lines: 23 },
    ],
    terminalOutput: [
      "\x1b[2m$ uv run pytest backend/tests/test_feed_resolvers.py -v\x1b[0m",
      "",
      "\x1b[32m12 passed\x1b[0m in 1.84s",
    ],
    observations: [
      "Feed resolver had zero test coverage",
      "Found and fixed a null-safety bug during test writing",
    ],
  },
  {
    id: "W-39",
    title: "Fix VNC reconnect on redeploy",
    agent: "frontend",
    status: "active",
    executionType: "browser",
    elapsed: "3m 05s",
    turns: 6,
    cost: 0.22,
    goal: "VNC thumbnail should reconnect automatically after agent redeploy without requiring page refresh.",
    tasks: [
      { id: "t1", title: "Trace reconnect flow", status: "done", agent: "frontend" },
      { id: "t2", title: "Fix token refresh on reconnect", status: "active", agent: "frontend" },
      { id: "t3", title: "Add retry budget reset", status: "pending" },
      { id: "t4", title: "Add regression test", status: "pending" },
    ],
    artifacts: [
      { path: "dashboard/components/agent/vnc-thumbnail.tsx", action: "modified", lines: 18 },
    ],
    terminalOutput: [
      "\x1b[2m$ Reading vnc-thumbnail.tsx...\x1b[0m",
      "\x1b[2m$ The token refresh path does not handle 401 from\x1b[0m",
      "\x1b[2m  the VNC proxy after redeploy. The old token is\x1b[0m",
      "\x1b[2m  still cached in the component ref.\x1b[0m",
      "",
      "\x1b[2m$ Editing vnc-thumbnail.tsx...\x1b[0m",
      "  + const fetchFreshToken = async () => {",
      "  +   tokenRef.current = null",
      "  +   return await requestVncToken(agentId)",
      "  + }",
    ],
    observations: [
      "Token is cached in useRef — not cleared on runtimeId change",
      "Retry budget exhausts before token is refreshed",
    ],
  },
  {
    id: "W-38",
    title: "Update API documentation",
    agent: "docs",
    status: "queued",
    executionType: "files",
    elapsed: "—",
    turns: 0,
    cost: 0,
    goal: "Regenerate API reference docs from current GraphQL schema. Update any stale endpoint descriptions.",
    tasks: [
      { id: "t1", title: "Generate schema docs", status: "pending" },
      { id: "t2", title: "Review and fix descriptions", status: "pending" },
    ],
    artifacts: [],
    terminalOutput: [],
    observations: [],
  },
]

export const PROJECT_SUMMARY = {
  name: "agentobox",
  totalCost: 1.12,
  activeAgents: 3,
  totalWork: 5,
  completedWork: 1,
}
