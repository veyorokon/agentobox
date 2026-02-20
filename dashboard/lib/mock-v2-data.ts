/**
 * Mock data for the v2 dashboard preview.
 *
 * Generates a realistic 45-minute agent session with 4 agents:
 *   lead, backend, frontend, qa
 *
 * Includes text messages, tool calls, status transitions, errors,
 * and cost events — all with deterministic timestamps.
 */

import type { Agent, AgentStatus } from '@/types';
import { getAgentColor } from '@/lib/agent-colors';

// ── Agent definitions ──

export interface AgentSummary extends Agent {}

const now = Date.now();
function minsAgo(m: number): string {
  return new Date(now - m * 60_000).toISOString();
}

export const MOCK_AGENTS: AgentSummary[] = [
  {
    id: 'a1',
    name: 'lead',
    role: 'lead',
    status: 'running',
    phase: '',
    vncUrl: '',
    sandboxId: '',
    runtime: 'docker',
    teamName: 'dev',
    sessionId: 's0',
    model: 'claude-opus-4-6',
    cwd: '/workspace',
    permissionMode: 'default',
    mcpServers: {},
    workspacePath: '/workspace',
    instructions: 'You are the team lead. Coordinate the backend, frontend, and QA agents. Review pull requests, resolve conflicts, and ensure sprint goals are met.',
    sessionCostUsd: '1.42',
    capabilities: {
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'SendMessage', 'TaskCreate', 'TaskUpdate', 'TaskList'],
      mcpServers: [
        { name: 'context7', status: 'connected', toolCount: 2 },
      ],
      model: 'claude-opus-4-6',
      version: '1.0.28',
      skills: ['commit', 'review-pr'],
    },

    createdAt: minsAgo(45),
  },
  {
    id: 'a2',
    name: 'backend',
    role: 'worker',
    status: 'running',
    phase: '',
    vncUrl: '',
    sandboxId: '',
    runtime: 'docker',
    teamName: 'dev',
    sessionId: 's1',
    model: 'claude-sonnet-4-5-20250929',
    cwd: '/workspace',
    permissionMode: 'default',
    mcpServers: {},
    workspacePath: '/workspace',
    instructions: 'You are the backend agent. Focus on Django models, services, GraphQL schema, and API endpoints. Run tests before committing.',
    sessionCostUsd: '0.67',
    capabilities: {
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
      mcpServers: [
        { name: 'context7', status: 'connected', toolCount: 2 },
      ],
      model: 'claude-sonnet-4-5-20250929',
      version: '1.0.28',
      skills: ['commit'],
    },

    createdAt: minsAgo(43),
  },
  {
    id: 'a3',
    name: 'frontend',
    role: 'worker',
    status: 'running',
    phase: '',
    vncUrl: '',
    sandboxId: '',
    runtime: 'docker',
    teamName: 'dev',
    sessionId: 's2',
    model: 'claude-sonnet-4-5-20250929',
    cwd: '/workspace',
    permissionMode: 'default',
    mcpServers: {},
    workspacePath: '/workspace',
    instructions: 'You are the frontend agent. Build Next.js components, manage Zustand stores, and ensure UI matches the cyberpunk design system.',
    sessionCostUsd: '0.53',
    capabilities: {
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'mcp__playwright__browser_snapshot', 'mcp__playwright__browser_click', 'mcp__playwright__browser_navigate', 'mcp__playwright__browser_take_screenshot'],
      mcpServers: [
        { name: 'playwright', status: 'connected', toolCount: 18 },
        { name: 'context7', status: 'connected', toolCount: 2 },
      ],
      model: 'claude-sonnet-4-5-20250929',
      version: '1.0.28',
      skills: ['frontend-design', 'commit'],
    },

    createdAt: minsAgo(42),
  },
  {
    id: 'a4',
    name: 'qa',
    role: 'worker',
    status: 'idle',
    phase: '',
    vncUrl: 'http://localhost:6080/vnc.html',
    sandboxId: '',
    runtime: 'docker',
    teamName: 'dev',
    sessionId: 's3',
    model: 'claude-sonnet-4-5-20250929',
    cwd: '/workspace',
    permissionMode: 'default',
    mcpServers: {},
    workspacePath: '/workspace',
    instructions: 'You are the QA agent. Run unit tests, integration tests, and Playwright visual tests. Report regressions to the team lead.',
    sessionCostUsd: '0.21',
    capabilities: {
      tools: ['Read', 'Bash', 'Glob', 'Grep', 'Task', 'mcp__playwright__browser_snapshot', 'mcp__playwright__browser_click', 'mcp__playwright__browser_navigate', 'mcp__playwright__browser_take_screenshot', 'mcp__playwright__browser_type'],
      mcpServers: [
        { name: 'playwright', status: 'connected', toolCount: 18 },
      ],
      model: 'claude-sonnet-4-5-20250929',
      version: '1.0.28',
      skills: ['webapp-testing', 'playwright-skill'],
    },

    createdAt: minsAgo(20),
  },
];

export const MOCK_AGENTS_MAP: Record<string, AgentSummary> = Object.fromEntries(
  MOCK_AGENTS.map((a) => [a.id, a])
);

// ── Feed items ──

export type FeedItemKind =
  | 'user-message'
  | 'agent-text'
  | 'activity'
  | 'status'
  | 'task'
  | 'system'
  | 'error'
  | 'question'
  | 'memory'
  | 'plan'
  | 'task-start'
  | 'task-end'
  | 'team-message';

export interface QuestionOption {
  label: string;
  description: string;
}

export interface AgentQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/** Tracks the user's answer for a single question */
export interface QuestionAnswer {
  /** Indices of selected options */
  selectedIndices: number[];
  /** If "Other" was chosen, the free text */
  otherText?: string;
}

// ── Tool expansion types ──

/** A single content block in tool_result (Anthropic API format) */
export interface ContentBlock {
  type: string;  // "text" | "image" | ...
  text?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  [key: string]: unknown;
}

export interface ToolUseDetail {
  name: string;
  /** Raw tool_use.input dict — keys vary by tool (file_path, command, pattern, etc.) */
  input: Record<string, any>;
  /** Raw tool_result.content — string for text results, ContentBlock[] for rich results */
  result: string | ContentBlock[];
  /** Whether the tool call errored */
  isError?: boolean;
}

// ── File tree types ──

export interface FileTreeAgent {
  agentId: string;
  agentName: string;
  agentColor: string;
  editCount: number;
  lastEditMinsAgo: number;
  operations: string[];
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  agents?: FileTreeAgent[];
  isNew?: boolean;
  hasConflict?: boolean;
  totalEdits?: number;
}

export interface FileTreeStats {
  totalFiles: number;
  totalEdits: number;
  agentCount: number;
  conflictCount: number;
}

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  agentId: string;
  agentName: string;
  /** Minutes ago from "now" */
  minsAgo: number;
  timestamp: string;
  /** For user-message / agent-text */
  text?: string;
  /** For user-message — image URLs attached to the message */
  imageUrls?: string[];
  /** For user-message — display label for who the user sent the message to */
  targetName?: string;
  /** For user-message — all targeted agent IDs (broadcast support) */
  targetAgentIds?: string[];
  /** For activity — tool summaries (with optional expansion data) */
  tools?: ToolUseDetail[];
  /** For status — transition info */
  fromStatus?: AgentStatus;
  toStatus?: AgentStatus;
  /** For task */
  taskSummary?: string;
  /** For error */
  errorText?: string;
  /** Running cumulative session cost at this point in the feed */
  cumulativeCostUsd?: number;
  /** For question — 1-4 questions from agent */
  questions?: AgentQuestion[];
  /** For question — answers (one per question, undefined entries = unanswered) */
  answers?: (QuestionAnswer | undefined)[];
  /** For question — tool_use_id needed to send answer back */
  toolUseId?: string;
  /** For memory — what was saved */
  memoryContent?: string;
  /** For plan — lifecycle stage */
  planStatus?: 'content' | 'approved';
  /** For plan — one-line summary */
  planSummary?: string;
  /** For plan (content) — numbered steps */
  planSteps?: string[];
  /** For task-start / task-end — task subject line */
  taskDividerSubject?: string;
  /** For task-start / task-end — reference to the TaskItem id */
  taskDividerId?: string;
  /** For task-start / task-end — short present-continuous label for timeline pills */
  taskDividerActiveForm?: string;
  /** For team-message — who sent the inter-agent message */
  senderName?: string;
}

let _id = 0;
function feedItem(
  kind: FeedItemKind,
  agentId: string,
  agentName: string,
  minutesAgo: number,
  extra: Partial<FeedItem> = {}
): FeedItem {
  return {
    id: `f-${_id++}`,
    kind,
    agentId,
    agentName,
    minsAgo: minutesAgo,
    timestamp: minsAgo(minutesAgo),
    ...extra,
  };
}

/**
 * Returns feed items sorted newest-first (reversed for display: oldest at top).
 */
export function generateMockFeed(): FeedItem[] {
  const items: FeedItem[] = [
    // === 45 min ago: Session start ===
    feedItem('system', 'a1', 'lead', 45, { text: 'Session started' }),
    feedItem('status', 'a1', 'lead', 45, { fromStatus: 'deploying', toStatus: 'running' }),

    // === 43 min ago: Lead delegates, agents deploy ===
    feedItem('status', 'a2', 'backend', 43, { fromStatus: 'deploying', toStatus: 'running' }),
    feedItem('status', 'a3', 'frontend', 42, { fromStatus: 'deploying', toStatus: 'running' }),

    feedItem('agent-text', 'a1', 'lead', 42, {
      text: "I'll coordinate this sprint. Backend: fix the auth token refresh bug in services/auth.ts. Frontend: redesign the agent card component with the new color system. QA will join after initial fixes land.",
    }),

    // === 40 min ago: User sends a clarification ===
    feedItem('user-message', 'a2', 'backend', 40, {
      text: 'The token refresh issue is in the middleware, not auth.ts. Check middleware/auth-guard.ts first.',
      targetName: 'backend',
    }),

    // === 39 min ago: Backend starts working ===
    feedItem('agent-text', 'a2', 'backend', 39, {
      text: "Got it. I'll look at the middleware first.",
    }),
    feedItem('activity', 'a2', 'backend', 38, {
      tools: [
        { name: 'Read', input: { file_path: 'middleware/auth-guard.ts' }, result: "import { NextRequest, NextResponse } from 'next/server';\nimport { tokenCache } from '../services/token-cache';\nimport { refreshAccessToken } from '../services/auth';\n\nexport async function authGuard(req: NextRequest) {\n  const token = req.headers.get('Authorization')?.replace('Bearer ', '');\n  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });\n\n  const cached = tokenCache.get(token);\n  if (cached && !cached.expired) return NextResponse.next();\n\n  // BUG: No mutex — concurrent requests both trigger refresh\n  const newToken = await refreshAccessToken(token);" },
        { name: 'Read', input: { file_path: 'services/auth.ts' }, result: "export async function refreshAccessToken(oldToken: string): Promise<string> {\n  const res = await fetch('/api/auth/refresh', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ token: oldToken }),\n  });\n  if (!res.ok) throw new Error('Token refresh failed');\n  const { accessToken } = await res.json();\n  return accessToken;\n}" },
        { name: 'Grep', input: { pattern: 'refreshToken' }, result: "middleware/auth-guard.ts:12:  const newToken = await refreshAccessToken(token);\nservices/auth.ts:1:export async function refreshAccessToken(oldToken: string)\nservices/token-cache.ts:8:  refreshToken(key: string): void {\ntests/auth-guard.test.ts:23:  it('should refresh token once', async () => {" },
      ],
    }),

    // === 37 min ago: Frontend plans card redesign ===
    feedItem('plan', 'a3', 'frontend', 37, {
      planStatus: 'content',
      planSummary: 'Redesign agent card with new color system',
      planSteps: [
        'Read existing agent-card.tsx and agent-colors.ts',
        'Replace hardcoded colors with identity color system',
        'Add augmented-ui tl-clip br-clip borders',
        'Add status dot with glow animation',
        'Run build check',
      ],
    }),
    feedItem('plan', 'a3', 'frontend', 36.5, {
      planStatus: 'approved',
      planSummary: 'Redesign agent card with new color system',
    }),

    // === 36 min ago: Frontend starts component work ===
    feedItem('agent-text', 'a3', 'frontend', 36, {
      text: 'Starting on the agent card redesign. Reading the existing component and color system.',
    }),
    feedItem('activity', 'a3', 'frontend', 35, {
      tools: [
        { name: 'Read', input: { file_path: 'components/agent-card.tsx' }, result: "import { Agent } from '@/types';\n\nexport function AgentCard({ agent }: { agent: Agent }) {\n  return (\n    <div className=\"border border-gray-700 rounded-lg p-4\">\n      <h3 className=\"text-white font-bold\">{agent.name}</h3>\n      <span className=\"text-gray-400\">{agent.status}</span>\n    </div>\n  );\n}" },
        { name: 'Read', input: { file_path: 'lib/agent-colors.ts' }, result: "const GOLDEN_ANGLE = 137.508;\nfunction agentOklch(index: number): string {\n  const hue = (index * GOLDEN_ANGLE) % 360;\n  return `oklch(var(--agent-l) var(--agent-c) ${hue}deg)`;\n}" },
      ],
    }),

    // === 34 min ago: Backend finds the bug ===
    feedItem('agent-text', 'a2', 'backend', 34, {
      text: 'Found the issue. The refresh token middleware catches expired tokens but the retry logic has a race condition. Two concurrent requests both trigger a refresh, and the second one fails because the first already invalidated the old token.',
    }),
    feedItem('activity', 'a2', 'backend', 33, {
      tools: [
        { name: 'Edit', input: { file_path: 'middleware/auth-guard.ts', old_string: '  if (cached && !cached.expired) return NextResponse.next();\n\n  // BUG: No mutex — concurrent requests both trigger refresh\n  const newToken = await refreshAccessToken(token);', new_string: '  if (cached && !cached.expired) return NextResponse.next();\n\n  // Use mutex to prevent concurrent refresh race condition\n  const newToken = await tokenCache.refreshWithLock(token, async () => {\n    return refreshAccessToken(token);\n  });' }, result: "The file was edited successfully." },
        { name: 'Edit', input: { file_path: 'services/token-cache.ts', old_string: 'class TokenCache {\n\n  refreshToken(key: string): void {', new_string: 'class TokenCache {\n  private locks = new Map<string, Promise<string>>();\n\n  async refreshWithLock(key: string, fn: () => Promise<string>): Promise<string> {\n    const existing = this.locks.get(key);\n    if (existing) return existing;\n    const promise = fn().finally(() => this.locks.delete(key));\n    this.locks.set(key, promise);\n    return promise;\n  }\n\n  refreshToken(key: string): void {' }, result: "The file was edited successfully." },
      ],
    }),

    // === 32 min ago: Backend saves memory about the race condition ===
    feedItem('memory', 'a2', 'backend', 32, {
      memoryContent: 'Auth middleware has race condition on concurrent token refresh — use mutex pattern',
    }),

    // === 30 min ago: Frontend building ===
    feedItem('activity', 'a3', 'frontend', 30, {
      tools: [
        { name: 'Edit', input: { file_path: 'components/agent-card.tsx', old_string: '    <div className="border border-gray-700 rounded-lg p-4">\n      <h3 className="text-white font-bold">{agent.name}</h3>\n      <span className="text-gray-400">{agent.status}</span>', new_string: '    <div\n      data-augmented-ui="tl-clip br-clip border"\n      style={{\n        \'--aug-border-bg\': getAgentColor(agent.name, agent.role),\n      }}\n    >\n      <AgentStatusDot status={agent.status} color={color} />\n      <h3 className="font-mono font-bold" style={{ color }}>{agent.name}</h3>' }, result: "The file was edited successfully." },
        { name: 'Write', input: { file_path: 'components/agent-status-dot.tsx', content: "import type { AgentStatus } from '@/types';\n\ninterface Props { status: AgentStatus; color: string }\n\nexport function AgentStatusDot({ status, color }: Props) {\n  const isActive = status === 'running';\n  return (\n    <span\n      className=\"w-2 h-2 rounded-full\"\n      style={{\n        background: isActive ? color : \"var(--muted-foreground)\",\n        boxShadow: isActive ? `0 0 6px ${color}` : 'none',\n      }}\n    />\n  );\n}" }, result: "The file was written successfully." },
        { name: 'Edit', input: { file_path: 'app/globals.css', old_string: '@keyframes border-pulse {', new_string: '@keyframes border-pulse {\n/* Agent card status dot glow */\n@keyframes status-glow {\n  0%, 100% { box-shadow: 0 0 4px currentColor; }\n  50% { box-shadow: 0 0 8px currentColor, 0 0 12px currentColor; }\n}' }, result: "The file was edited successfully." },
      ],
    }),

    // === 28 min ago: Backend runs tests — FAILURE ===
    feedItem('activity', 'a2', 'backend', 28, {
      tools: [{ name: 'Bash', input: { command: 'npm test -- --grep auth' }, result: '> workspace@1.0.0 test\n> jest --grep auth\n\n FAIL tests/auth-guard.test.ts\n  Token refresh race condition\n    \u2713 should validate token (12ms)\n    \u2713 should reject expired token (8ms)\n    \u2717 should refresh token once (45ms)\n    \u2713 should cache refreshed token (15ms)\n\n  1 of 4 tests failed', isError: true }],
    }),
    feedItem('error', 'a2', 'backend', 27, {
      errorText: 'FAIL tests/auth-guard.test.ts\n  Token refresh race condition\n    Expected: token to be refreshed once\n    Received: refreshToken called 2 times\n\n  1 of 4 tests failed',
    }),

    // === 26 min ago: Backend fixes test failure ===
    feedItem('agent-text', 'a2', 'backend', 26, {
      text: 'Test failure caught the exact race condition. Adding a mutex lock around the token refresh.',
    }),
    feedItem('activity', 'a2', 'backend', 25, {
      tools: [
        { name: 'Edit', input: { file_path: 'middleware/auth-guard.ts', old_string: '  // Use mutex to prevent concurrent refresh race condition\n  const newToken = await tokenCache.refreshWithLock(token, async () => {\n    return refreshAccessToken(token);\n  });', new_string: '  // Use mutex to prevent concurrent refresh race condition\n  const newToken = await tokenCache.refreshWithLock(token, () =>\n    refreshAccessToken(token)\n  );\n  if (!newToken) return NextResponse.json({ error: "Refresh failed" }, { status: 401 });' }, result: "The file was edited successfully." },
        { name: 'Bash', input: { command: 'npm test -- --grep auth' }, result: '> workspace@1.0.0 test\n> jest --grep auth\n\n PASS tests/auth-guard.test.ts\n  Token refresh race condition\n    \u2713 should validate token (11ms)\n    \u2713 should reject expired token (7ms)\n    \u2713 should refresh token once (42ms)\n    \u2713 should cache refreshed token (14ms)\n\n  4 of 4 tests passed' },
      ],
    }),
    feedItem('task', 'a2', 'backend', 24, { taskSummary: 'Auth fix verified — all 4 tests passing' }),

    // === 22 min ago: Frontend finishes first pass ===
    feedItem('agent-text', 'a3', 'frontend', 22, {
      text: 'Agent card redesign complete. Added identity color borders, status dot with glow, and augmented-ui clip corners. Ready for review.',
    }),
    feedItem('activity', 'a3', 'frontend', 21, {
      tools: [
        { name: 'Edit', input: { file_path: 'components/agent-card.tsx', old_string: "import { Agent } from '@/types';", new_string: "import { Agent } from '@/types';\nimport { getAgentColor } from '@/lib/agent-colors';\nimport { AgentStatusDot } from './agent-status-dot';" }, result: "The file was edited successfully." },
        { name: 'Bash', input: { command: 'npx next build' }, result: '   Creating an optimized production build...\n   Compiled successfully.\n\n   Route (app)              Size     First Load JS\n   \u250C \u25CB /                     5.2 kB       89.4 kB\n   \u2514 \u25CB /v2                   12.1 kB      96.3 kB\n   \u2713 Build completed in 8.2s' },
      ],
    }),
    feedItem('task', 'a3', 'frontend', 21, { taskSummary: 'Agent card redesign — build passes' }),

    // === 20.5 min ago: Frontend takes screenshots of the new card ===
    feedItem('activity', 'a3', 'frontend', 20.5, {
      tools: [
        { name: 'mcp__playwright__browser_take_screenshot', input: { type: 'png' }, result: [{ type: 'image', source: { type: 'url', url: '/seed/dashboard-overview.png' } }] },
        { name: 'mcp__playwright__browser_take_screenshot', input: { type: 'png' }, result: [{ type: 'image', source: { type: 'url', url: '/seed/dashboard-frontend-feed.png' } }] },
        { name: 'mcp__playwright__browser_take_screenshot', input: { type: 'png' }, result: [{ type: 'image', source: { type: 'url', url: '/seed/feed-diff-expanded.png' } }] },
      ],
    }),

    // === 20 min ago: QA joins ===
    feedItem('status', 'a4', 'qa', 20, { fromStatus: 'deploying', toStatus: 'running' }),
    feedItem('agent-text', 'a1', 'lead', 19, {
      text: 'QA is now online. Please run the full test suite and check the auth middleware changes + the new agent card component.',
    }),

    // === 18 min ago: Lead reviews backend work ===
    feedItem('agent-text', 'a1', 'lead', 18, {
      text: "Backend's auth fix looks solid. The mutex approach prevents the race condition without blocking unrelated requests. Approved.",
    }),
    feedItem('task', 'a1', 'lead', 17, { taskSummary: 'Reviewed backend auth fix' }),

    // === 16 min ago: QA starts testing ===
    feedItem('activity', 'a4', 'qa', 16, {
      tools: [
        { name: 'Bash', input: { command: 'npm test' }, result: '> workspace@1.0.0 test\n> jest\n\n PASS tests/auth-guard.test.ts (4 tests)\n PASS tests/token-cache.test.ts (6 tests)\n PASS tests/agent-card.test.tsx (8 tests)\n PASS tests/api/endpoints.test.ts (29 tests)\n\nTest Suites: 4 passed, 4 total\nTests:       47 passed, 47 total\nTime:        3.21s' },
        { name: 'Read', input: { file_path: 'tests/auth-guard.test.ts' }, result: "import { authGuard } from '../middleware/auth-guard';\nimport { tokenCache } from '../services/token-cache';\n\ndescribe('Token refresh race condition', () => {\n  it('should validate token', async () => {\n    const req = mockRequest({ token: 'valid-token' });\n    const res = await authGuard(req);\n    expect(res.status).toBe(200);\n  });\n\n  it('should reject expired token', async () => {\n    const req = mockRequest({ token: 'expired', noRefresh: true });\n    const res = await authGuard(req);\n    expect(res.status).toBe(401);\n  });" },
      ],
    }),
    feedItem('agent-text', 'a4', 'qa', 15, {
      text: 'Unit tests all passing (47/47). Starting Playwright integration tests for the auth flow.',
    }),
    feedItem('activity', 'a4', 'qa', 14, {
      tools: [{ name: 'Bash', input: { command: 'npx playwright test auth' }, result: 'Running 6 tests using 2 workers\n\n  \u2713 auth-flow.spec.ts:5 login with valid credentials (1.2s)\n  \u2713 auth-flow.spec.ts:15 refresh token on expiry (2.1s)\n  \u2713 auth-flow.spec.ts:28 concurrent requests share refresh (1.8s)\n  \u2713 auth-flow.spec.ts:42 logout clears cache (0.9s)\n  \u2713 auth-flow.spec.ts:51 invalid token redirect (1.1s)\n  \u2713 auth-flow.spec.ts:62 token persistence across tabs (2.4s)\n\n  6 passed (9.5s)' }],
    }),

    // === 13 min ago: QA takes screenshots of auth flow and agent card ===
    feedItem('activity', 'a4', 'qa', 13, {
      tools: [
        { name: 'mcp__playwright__browser_take_screenshot', input: { type: 'png' }, result: [{ type: 'image', source: { type: 'url', url: '/seed/output-qa-expanded.png' } }] },
        { name: 'mcp__playwright__browser_take_screenshot', input: { type: 'png' }, result: [{ type: 'image', source: { type: 'url', url: '/seed/files-tree-view.png' } }] },
      ],
    }),

    // === 11 min ago: QA reports success ===
    feedItem('agent-text', 'a4', 'qa', 11, {
      text: 'All integration tests passing. Auth token refresh works correctly under concurrent load. No visual regressions on the new agent card.',
    }),
    feedItem('task', 'a4', 'qa', 10, { taskSummary: 'QA sign-off — all tests green' }),
    feedItem('status', 'a4', 'qa', 10, { fromStatus: 'running', toStatus: 'idle' }),

    // === 9 min ago: Backend asks about caching strategy ===
    feedItem('question', 'a2', 'backend', 9, {
      questions: [
        {
          question: 'The token cache needs a TTL policy. Which approach should I use?',
          header: 'Cache TTL',
          options: [
            { label: 'Short TTL (5 min)', description: 'More secure, more refresh calls' },
            { label: 'Match token expiry', description: 'Cache until token actually expires' },
            { label: 'Sliding window', description: 'Reset TTL on each access' },
          ],
          multiSelect: false,
        },
      ],
      answers: [{ selectedIndices: [1] }],
    }),

    // === 8 min ago: User asks for a small tweak ===
    feedItem('user-message', 'a3', 'frontend', 8, {
      text: 'Can you make the status dot pulse animation slower? The current 2s feels frantic.',
      targetName: 'frontend',
    }),
    feedItem('agent-text', 'a3', 'frontend', 7, {
      text: 'Sure, slowing the pulse to 3s with a gentler easing curve.',
    }),
    feedItem('activity', 'a3', 'frontend', 6, {
      tools: [{ name: 'Edit', input: { file_path: 'app/globals.css', old_string: '.deploying-card::after {\n  animation: border-pulse 2s ease-in-out infinite !important;', new_string: '.deploying-card::after {\n  animation: border-pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite !important;' }, result: "The file was edited successfully." }],
    }),

    // === 4 min ago: Lead wraps up ===
    feedItem('agent-text', 'a1', 'lead', 4, {
      text: 'Sprint complete. Auth race condition fixed, agent card redesigned, all tests passing. Total session cost: $2.83.',
    }),

    // === 2 min ago: Final backend activity ===
    feedItem('activity', 'a2', 'backend', 2, {
      tools: [
        { name: 'Read', input: { file_path: 'CHANGELOG.md' }, result: '# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-02-10\n- Added agent card component\n- Improved token refresh logic' },
        { name: 'Edit', input: { file_path: 'CHANGELOG.md', old_string: '## [Unreleased]\n', new_string: '## [Unreleased]\n- Fixed auth token refresh race condition (mutex lock on concurrent refresh)\n- Added error handling for failed token refresh attempts\n' }, result: "The file was edited successfully." },
      ],
    }),
    feedItem('agent-text', 'a2', 'backend', 1, {
      text: 'Updated CHANGELOG with the auth fix entry.',
    }),

    // === Just now: Frontend has a pending question (multi-question example) ===
    feedItem('question', 'a3', 'frontend', 0.5, {
      questions: [
        {
          question: 'The pulse animation change affects all status dots globally. Should I scope it to agent cards only, or keep it global?',
          header: 'Scope',
          options: [
            { label: 'Agent cards only', description: 'Scoped — other dots keep the original timing' },
            { label: 'Global change', description: 'All status dots use the slower pulse' },
          ],
          multiSelect: false,
        },
        {
          question: 'Which easing curve for the new pulse?',
          header: 'Easing',
          options: [
            { label: 'ease-in-out', description: 'Smooth, natural feel' },
            { label: 'cubic-bezier', description: 'Custom snappy curve with soft tail' },
            { label: 'linear', description: 'Mechanical, constant rate' },
          ],
          multiSelect: false,
        },
      ],
    }),
  ];

  // Inject task-start / task-end dividers from timeline tasks
  const tasks = generateTaskItems();
  for (const task of tasks) {
    items.push(
      feedItem('task-start', task.agentId, task.agentName, task.startMinsAgo, {
        taskDividerSubject: task.subject,
        taskDividerId: task.id,
        taskDividerActiveForm: task.activeForm,
      })
    );
    if (task.endMinsAgo != null) {
      items.push(
        feedItem('task-end', task.agentId, task.agentName, task.endMinsAgo, {
          taskDividerSubject: task.subject,
          taskDividerId: task.id,
          taskDividerActiveForm: task.activeForm,
        })
      );
    }
  }

  // Sort oldest first (largest minsAgo first)
  items.sort((a, b) => b.minsAgo - a.minsAgo);

  // Compute cumulative cost — ramps to ~$2.83 across the session.
  // Cost increments by kind: inference-heavy items cost more.
  let cumulative = 0;
  for (const item of items) {
    let increment = 0;
    switch (item.kind) {
      case 'agent-text':
        // Opus (lead) costs more than Sonnet (workers)
        increment = item.agentId === 'a1' ? 0.16 : 0.05;
        break;
      case 'activity':
        increment = 0.08 * (item.tools?.length ?? 1);
        break;
      case 'error':
        increment = 0.04;
        break;
      case 'question':
        increment = 0.05;
        break;
      case 'memory':
        increment = 0.02;
        break;
      case 'plan':
        increment = item.planStatus === 'content' ? 0.06 : 0.02;
        break;
      // status, system, task, user-message: no LLM cost
    }
    cumulative += increment;
    item.cumulativeCostUsd = Math.round(cumulative * 100) / 100;
  }

  return items;
}

// ── Timeline data (task-based blocks + point events) ──

export interface TaskItem {
  id: string;
  agentId: string;
  agentName: string;
  /** Task subject (from TaskCreate) */
  subject: string;
  /** Short active-form label for narrow pills */
  activeForm: string;
  /** When agent started working (minsAgo — larger = further in the past) */
  startMinsAgo: number;
  /** When completed (minsAgo). undefined = still in progress */
  endMinsAgo?: number;
  status: 'completed' | 'in_progress';
}

export type TimelineEventKind = 'error' | 'message' | 'status';

export interface TimelineEvent {
  id: string;
  agentId: string;
  agentName: string;
  kind: TimelineEventKind;
  minsAgo: number;
  summary: string;
}

export function generateTaskItems(): TaskItem[] {
  return [
    // ── Lead ──
    { id: 'tt-1', agentId: 'a1', agentName: 'lead', subject: 'Coordinate sprint kickoff', activeForm: 'Coordinating', startMinsAgo: 45, endMinsAgo: 37, status: 'completed' },
    { id: 'tt-2', agentId: 'a1', agentName: 'lead', subject: 'Review backend auth fix', activeForm: 'Reviewing', startMinsAgo: 19, endMinsAgo: 17, status: 'completed' },
    { id: 'tt-3', agentId: 'a1', agentName: 'lead', subject: 'Coordinate QA testing', activeForm: 'Coordinating QA', startMinsAgo: 15, endMinsAgo: 11, status: 'completed' },
    { id: 'tt-4', agentId: 'a1', agentName: 'lead', subject: 'Sprint wrap-up & summary', activeForm: 'Wrapping up', startMinsAgo: 8, endMinsAgo: 4, status: 'completed' },

    // ── Backend ──
    { id: 'tt-5', agentId: 'a2', agentName: 'backend', subject: 'Fix auth token race condition', activeForm: 'Fixing auth', startMinsAgo: 43, endMinsAgo: 24, status: 'completed' },
    { id: 'tt-6', agentId: 'a2', agentName: 'backend', subject: 'Optimize query performance', activeForm: 'Optimizing', startMinsAgo: 20, endMinsAgo: 13, status: 'completed' },
    { id: 'tt-7', agentId: 'a2', agentName: 'backend', subject: 'Update CHANGELOG', activeForm: 'Updating changelog', startMinsAgo: 10, endMinsAgo: 1, status: 'completed' },

    // ── Frontend ──
    { id: 'tt-8', agentId: 'a3', agentName: 'frontend', subject: 'Redesign agent card component', activeForm: 'Redesigning card', startMinsAgo: 42, endMinsAgo: 20, status: 'completed' },
    { id: 'tt-9', agentId: 'a3', agentName: 'frontend', subject: 'Adjust pulse animation speed', activeForm: 'Adjusting animation', startMinsAgo: 8, endMinsAgo: 5, status: 'completed' },
    { id: 'tt-10', agentId: 'a3', agentName: 'frontend', subject: 'Scope animation change', activeForm: 'Scoping changes', startMinsAgo: 3, status: 'in_progress' },

    // ── QA ──
    { id: 'tt-11', agentId: 'a4', agentName: 'qa', subject: 'Run full test suite & integration tests', activeForm: 'Running tests', startMinsAgo: 20, endMinsAgo: 10, status: 'completed' },
  ];
}

/** Build file tree from feed activity items */
export function generateMockFileTree(feedItems: FeedItem[]): { tree: FileTreeNode[]; stats: FileTreeStats } {
  const fileMap = new Map<string, { agents: Map<string, FileTreeAgent>; isNew: boolean }>();

  for (const item of feedItems) {
    if (item.kind !== 'activity' || !item.tools) continue;
    for (const tool of item.tools) {
      const filePath = tool.input?.file_path;
      if (!filePath) continue;
      // Skip non-file tools (Bash commands, Grep patterns)
      const isFileOp = ['Read', 'Write', 'Edit', 'Glob'].includes(tool.name);
      if (!isFileOp) continue;

      const path = filePath;
      if (!fileMap.has(path)) {
        fileMap.set(path, { agents: new Map(), isNew: false });
      }
      const entry = fileMap.get(path)!;
      if (tool.name === 'Write') entry.isNew = true;

      const agentKey = item.agentId;
      if (!entry.agents.has(agentKey)) {
        const agentData = MOCK_AGENTS_MAP[item.agentId];
        entry.agents.set(agentKey, {
          agentId: item.agentId,
          agentName: item.agentName,
          agentColor: agentData
            ? getAgentColor(agentData.name, agentData.role)
            : 'var(--muted-foreground)',
          editCount: 0,
          lastEditMinsAgo: item.minsAgo,
          operations: [],
        });
      }
      const agentEntry = entry.agents.get(agentKey)!;
      agentEntry.editCount++;
      if (item.minsAgo < agentEntry.lastEditMinsAgo) {
        agentEntry.lastEditMinsAgo = item.minsAgo;
      }
      if (!agentEntry.operations.includes(tool.name)) {
        agentEntry.operations.push(tool.name);
      }
    }
  }

  // Build nested tree from flat paths
  const root: FileTreeNode[] = [];

  for (const [path, data] of fileMap) {
    const parts = path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.name === part);
      if (!existing) {
        const agents = Array.from(data.agents.values());
        const editAgents = agents.filter((a) => a.operations.some((op) => op === 'Edit' || op === 'Write'));
        existing = {
          name: part,
          path: fullPath,
          type: isFile ? 'file' : 'directory',
          children: isFile ? undefined : [],
          agents: isFile ? agents : undefined,
          isNew: isFile ? data.isNew : undefined,
          hasConflict: isFile ? editAgents.length >= 2 : undefined,
          totalEdits: isFile ? agents.reduce((sum, a) => sum + a.editCount, 0) : undefined,
        };
        current.push(existing);
      }
      if (!isFile) {
        current = existing.children!;
      }
    }
  }

  // Propagate conflict indicator to parent directories
  function propagateConflicts(nodes: FileTreeNode[]): boolean {
    let hasChildConflict = false;
    for (const node of nodes) {
      if (node.type === 'directory' && node.children) {
        const childConflict = propagateConflicts(node.children);
        if (childConflict) {
          node.hasConflict = true;
          hasChildConflict = true;
        }
      } else if (node.hasConflict) {
        hasChildConflict = true;
      }
    }
    return hasChildConflict;
  }
  propagateConflicts(root);

  // Compute stats
  let totalFiles = 0;
  let totalEdits = 0;
  let conflictCount = 0;
  const agentIds = new Set<string>();

  for (const [, data] of fileMap) {
    totalFiles++;
    for (const [agentId, agentEntry] of data.agents) {
      totalEdits += agentEntry.editCount;
      agentIds.add(agentId);
    }
    const editAgents = Array.from(data.agents.values()).filter((a) =>
      a.operations.some((op) => op === 'Edit' || op === 'Write')
    );
    if (editAgents.length >= 2) conflictCount++;
  }

  return {
    tree: root,
    stats: { totalFiles, totalEdits, agentCount: agentIds.size, conflictCount },
  };
}


export function generateTimelineEvents(): TimelineEvent[] {
  return [
    // Status transitions
    { id: 'te-1', agentId: 'a1', agentName: 'lead', kind: 'status', minsAgo: 45, summary: 'Deployed' },
    { id: 'te-2', agentId: 'a2', agentName: 'backend', kind: 'status', minsAgo: 43, summary: 'Deployed' },
    { id: 'te-3', agentId: 'a3', agentName: 'frontend', kind: 'status', minsAgo: 42, summary: 'Deployed' },
    { id: 'te-4', agentId: 'a4', agentName: 'qa', kind: 'status', minsAgo: 20, summary: 'Deployed' },
    { id: 'te-5', agentId: 'a4', agentName: 'qa', kind: 'status', minsAgo: 10, summary: 'Idle' },

    // Errors
    { id: 'te-6', agentId: 'a2', agentName: 'backend', kind: 'error', minsAgo: 27, summary: 'Test failure: token refresh race condition' },

    // User messages
    { id: 'te-7', agentId: 'a2', agentName: 'backend', kind: 'message', minsAgo: 40, summary: 'User: check middleware/auth-guard.ts' },
    { id: 'te-8', agentId: 'a3', agentName: 'frontend', kind: 'message', minsAgo: 8, summary: 'User: slow down pulse animation' },
  ];
}
