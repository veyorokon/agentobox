"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  ArrowUp,
  Users,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  AlertCircle,
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
} from "lucide-react"
import { cn, agentHue, formatCost } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible } from "@/components/ui/collapsible"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { CopyButton } from "@/components/shared/copy-button"

/* ================================================================== */
/*  FAKE DATA                                                          */
/* ================================================================== */

type FakeAgent = {
  id: string
  name: string
  status: "running" | "error" | "idle" | "stopped" | "waiting" | "deploying"
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
}

const AGENTS: FakeAgent[] = [
  {
    id: "1",
    name: "backend",
    status: "running",
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
  },
  {
    id: "2",
    name: "frontend",
    status: "running",
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
  },
  {
    id: "3",
    name: "qa",
    status: "error",
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
  },
  {
    id: "4",
    name: "devops",
    status: "idle",
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
  },
  {
    id: "5",
    name: "docs",
    status: "stopped",
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
  },
  {
    id: "6",
    name: "infra",
    status: "deploying" as const,
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

  // Backend finishes first turn — SUMMARY (not the full verbose output)
  {
    type: "summary",
    agent: "backend",
    summary: "Fixed JWT validation — converted Date.now() to seconds, added 30s clock skew tolerance, updated error logging in validateToken()",
    cost: 0.08,
    turns: 5,
    duration: "2m 10s",
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
/*  STATUS CONFIG                                                      */
/* ================================================================== */

const STATUS_CONFIG: Record<
  string,
  { dot: string; label: string; glow?: string; text?: string }
> = {
  running: { dot: "bg-success", label: "Running", glow: "text-success", text: "text-success" },
  idle: { dot: "bg-info", label: "Idle", text: "text-info" },
  waiting: { dot: "bg-warning", label: "Waiting", text: "text-warning" },
  error: { dot: "bg-danger", label: "Error", text: "text-danger" },
  stopped: { dot: "bg-muted/50", label: "Stopped", text: "text-muted" },
  deploying: { dot: "bg-accent", label: "Starting", text: "text-accent" },
}

const PILL_CONFIG = [
  { key: "error" as const, dot: "bg-danger", text: "text-danger" },
  { key: "waiting" as const, dot: "bg-warning", text: "text-warning" },
  { key: "running" as const, dot: "bg-success", text: "text-success", animate: true },
  { key: "deploying" as const, dot: "bg-accent", text: "text-accent" },
  { key: "idle" as const, dot: "bg-info", text: "text-muted" },
  { key: "stopped" as const, dot: "bg-muted/40", text: "text-muted/50" },
]

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
}: {
  agent: string
  summary: string
  cost: number
  turns: number
  duration: string
  isError?: boolean
}) {
  return (
    <div className="flex gap-2.5 min-w-0">
      <ChatAvatar name={agent} />
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
function AgentStatusLine({ agent, from, to }: { agent: string; from: string; to: string }) {
  const toConfig = STATUS_CONFIG[to] ?? STATUS_CONFIG.stopped

  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <AgentAvatar name={agent} size="sm" />
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
function TeamErrorAlert({ agent, text }: { agent: string; text: string }) {
  return (
    <div className="flex gap-2.5 min-w-0">
      <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-danger-subtle mt-1">
        <AlertCircle className="h-3.5 w-3.5 text-danger" />
      </div>
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

  const activeAgents = agents.filter((a) => a.status === "running" || a.status === "idle" || a.status === "deploying")
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
/*  FLEET HEALTH PILLS                                                 */
/* ================================================================== */

function FleetHealthPills({
  statusCounts,
  layout,
}: {
  statusCounts: Record<string, number>
  layout: "vertical" | "horizontal"
}) {
  const pills = PILL_CONFIG.filter((p) => (statusCounts[p.key] ?? 0) > 0)

  if (pills.length === 0) return null

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        layout === "vertical" ? "flex-col" : "flex-row gap-2",
      )}
    >
      {pills.map((pill) => (
        <span
          key={pill.key}
          className={cn(
            "inline-flex items-center gap-0.5 font-mono text-[9px] tabular-nums",
            pill.text,
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              pill.dot,
              pill.animate && "animate-breathe text-success",
            )}
          />
          {statusCounts[pill.key]}
        </span>
      ))}
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
}) {
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { running: 0, error: 0, idle: 0, stopped: 0, waiting: 0, deploying: 0 }
    for (const a of agents) counts[a.status] = (counts[a.status] ?? 0) + 1
    return counts
  }, [agents])

  const totalCost = useMemo(() => agents.reduce((sum, a) => sum + a.cost, 0), [agents])

  /* ---- Collapsed state: 48px icon rail ---- */
  if (!isOpen) {
    return (
      <aside className="group/rail w-12 h-full bg-surface-sunken border-r-[0.5px] border-border-default flex flex-col shrink-0 relative">
        {/* Hover edge hint — subtle accent line on right edge */}
        <div className="absolute top-0 bottom-0 right-0 w-px bg-transparent group-hover/rail:bg-accent/25 transition-colors" />

        {/* Project initial */}
        <button
          type="button"
          onClick={onToggleOpen}
          className="pt-3 pb-2 flex justify-center hover:bg-surface-raised/30 transition-colors"
          title="Open panel"
        >
          <div className="h-6 w-6 rounded-md bg-accent/15 flex items-center justify-center text-[11px] font-bold text-accent">
            A
          </div>
        </button>

        {/* Agent avatars */}
        <div className="flex-1 flex flex-col items-center gap-1.5 py-2 overflow-y-auto">
          {agents.map((agent) => {
            const config = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.stopped
            const isSelected = expandedIds.has(agent.id)
            const isRunning = agent.status === "running"
            const isStopped = agent.status === "stopped"

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
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface-sunken",
                    config.dot,
                    isRunning && "animate-breathe text-success",
                  )}
                />
                {isSelected && (
                  <span className="absolute inset-0 rounded-md ring-2 ring-accent/50" />
                )}
              </button>
            )
          })}
        </div>

        {/* Fleet health */}
        <div className="py-2 flex flex-col items-center gap-1 border-t border-border-subtle">
          <FleetHealthPills statusCounts={statusCounts} layout="vertical" />
        </div>

        {/* Expand button — explicit affordance */}
        <div className="flex justify-center py-1.5 border-t border-border-subtle">
          <button
            type="button"
            onClick={onToggleOpen}
            className="p-1 rounded-md text-muted/40 hover:text-accent hover:bg-accent/10 transition-colors"
            title="Expand panel"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Bottom: secrets + cost + user avatar */}
        <div className="py-2 flex flex-col items-center gap-2 border-t border-border-default">
          <button
            type="button"
            onClick={onOpenSecrets}
            className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
            title="Project secrets"
          >
            <KeyRound className="h-3.5 w-3.5" />
          </button>
          <span className="text-[9px] text-muted/60 font-mono tabular-nums">
            {formatCost(totalCost)}
          </span>
          <div
            className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent"
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

      {/* Project selector placeholder */}
      <div className="h-10 px-3 flex items-center border-b border-border-default shrink-0">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-1 py-1 -ml-1 rounded-md hover:bg-surface-sunken/40 transition-colors"
        >
          <div className="h-6 w-6 rounded-md bg-accent/15 flex items-center justify-center text-[11px] font-bold text-accent shrink-0">
            A
          </div>
          <span className="text-sm font-medium text-default">agentobox</span>
          <ChevronRight size={12} className="text-muted/40 rotate-90 shrink-0" />
        </button>
      </div>

      {/* Panel header: title + expand-all + collapse */}
      <div className="h-8 px-3 flex items-center gap-2 border-b border-border-default shrink-0">
        <Users className="h-3.5 w-3.5 text-muted" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted flex-1">
          Agents
        </span>
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
        <button
          type="button"
          onClick={onToggleOpen}
          className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
          title="Collapse panel"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Agent cards */}
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2">
          {agents.map((agent) => (
            <AgentCardRow
              key={agent.id}
              agent={agent}
              isOpen={expandedIds.has(agent.id)}
              onToggle={() => onToggleAgent(agent.id)}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Fleet health horizontal */}
      <div className="px-3 py-1.5 border-t border-border-subtle flex items-center gap-2">
        <FleetHealthPills statusCounts={statusCounts} layout="horizontal" />
        <span className="text-[9px] text-muted/40 font-mono ml-auto">
          {agents.length} agents
        </span>
      </div>

      {/* Bottom toolbar: secrets + cost + user */}
      <div className="px-3 py-2 border-t border-border-default flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenSecrets}
          className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
          title="Project secrets"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs text-muted font-mono tabular-nums">
          {formatCost(totalCost)}
        </span>
        <span className="flex-1" />
        <div
          className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent"
          title="vahid"
        >
          V
        </div>
      </div>
    </aside>
  )
}

/* ================================================================== */
/*  COMPOSER BAR                                                       */
/* ================================================================== */

/**
 * Composer bar — main feed message input.
 * Broadcasts to all agents by default, use @agent to target one.
 * Individual agent messaging happens in the right panel's mini-composer.
 */
function ComposerBar() {
  return (
    <div className="px-6 pb-4 pt-2 max-w-3xl mx-auto w-full shrink-0">
      <div className="relative rounded-2xl border-[0.5px] border-border-default bg-surface-raised/60 focus-within:bg-surface-raised focus-within:border-border-default">
        {/* Text input */}
        <textarea
          placeholder="Message your team... (type @ to target an agent)"
          rows={1}
          className="w-full bg-transparent border-none outline-none resize-none px-4 pt-4 pb-2 text-sm text-default placeholder:text-muted min-h-[52px] max-h-[40vh]"
        />

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-3 pb-3">
          {/* Left side */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              className="rounded-lg p-1.5 text-muted cursor-not-allowed opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-muted">
              <Users className="h-3 w-3" />
              All agents
            </span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
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
    </div>
  )
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

function TeamFeed() {
  return (
    <div className="flex flex-col h-full min-w-0">
      <ScrollArea className="flex-1 overflow-y-auto dotted-grid">
        <div className="max-w-3xl mx-auto w-full px-6 py-4 space-y-3">
          {TEAM_FEED.map((item, i) => {
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
                  />
                )
              case "status":
                return <AgentStatusLine key={i} agent={item.agent} from={item.from} to={item.to} />
              case "error":
                return <TeamErrorAlert key={i} agent={item.agent} text={item.text} />
              case "question":
                return <QuestionCard key={i} agent={item.agent} question={item.question} options={item.options} />
              default:
                return null
            }
          })}
        </div>
      </ScrollArea>

      <ComposerBar />
    </div>
  )
}


/* ================================================================== */
/*  AGENT CARDS + VNC PANEL (unified)                                  */
/* ================================================================== */

/** VNC thumbnail placeholder — aspect ratio matches a 16:10 display */
function VncThumbnail({ agent }: { agent: FakeAgent }) {
  const isRunning = agent.status === "running"
  const isStopped = agent.status === "stopped"

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
              {agent.name} — {isRunning ? agent.task : isStopped ? "session ended" : agent.status}
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
            ) : agent.status === "error" ? (
              <div className="space-y-0.5">
                <p className="text-[6px] font-mono text-danger/50 leading-tight">Error: {agent.task}</p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <span className="text-[7px] font-mono text-muted/25">{agent.status}</span>
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
/*  AGENT SETTINGS PANEL — config form inside expanded card            */
/* ================================================================== */

function AgentSettingsPanel({ agent }: { agent: FakeAgent }) {
  const [model, setModel] = useState(agent.model)
  const [instructions, setInstructions] = useState(agent.instructions)
  const dirty = model !== agent.model || instructions !== agent.instructions

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

type ViewMode = "terminal" | "feed" | "settings"

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
}: {
  agent: FakeAgent
  isOpen: boolean
  onToggle: () => void
}) {
  const config = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.stopped
  const isRunning = agent.status === "running"
  const isError = agent.status === "error"
  const isStopped = agent.status === "stopped"
  const [viewMode, setViewMode] = useState<ViewMode>("terminal")

  const VIEW_MODES: { id: ViewMode; icon: typeof Monitor; label: string }[] = [
    { id: "terminal", icon: Monitor, label: "Screen" },
    { id: "feed", icon: List, label: "Feed" },
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
      {/* Header row — always visible, click to toggle */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-2.5 py-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <AgentAvatar name={agent.name} size="sm" stopped={isStopped} />
          <span
            className={cn(
              "text-[12px] font-medium shrink-0",
              isStopped ? "text-muted" : "text-default",
            )}
          >
            {agent.name}
          </span>
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
      </button>

      {/* Open content — animated reveal */}
      <Collapsible open={isOpen}>
        {/* Content area — swaps based on view mode */}
        <div className="px-3 pb-2">
          {viewMode === "terminal" && <VncThumbnail agent={agent} />}
          {viewMode === "feed" && <AgentDetailFeed agent={agent} />}
          {viewMode === "settings" && <AgentSettingsPanel agent={agent} />}
        </div>

        {/* Bottom toolbar: view icons | mini composer | todo */}
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
  const isRunning = agent.status === "running"
  const isError = agent.status === "error"

  return (
    <div className="border-t border-border-subtle flex flex-col">
      {/* Mini-feed header */}
      <div className="px-3 py-1.5 flex items-center gap-2 bg-surface-sunken/30">
        <MessageSquare className="h-3 w-3 text-muted/60" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/60">
          Detail Feed
        </span>
        <span className="text-[9px] text-muted/40 font-mono">
          source: content blocks
        </span>
      </div>

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
              {agent.status === "deploying" ? "Initializing workspace..." : "No activity yet"}
            </span>
          </div>
        )}
      </div>

    </div>
  )
}

function AgentCardsPanel({
  agents,
  expandedIds,
  onToggleAgent,
}: {
  agents: FakeAgent[]
  expandedIds: Set<string>
  onToggleAgent: (id: string) => void
}) {
  return (
    <ScrollArea className="h-full overflow-y-auto">
      <div className="p-3 space-y-2">
        {agents.map((agent) => (
          <AgentCardRow
            key={agent.id}
            agent={agent}
            isOpen={expandedIds.has(agent.id)}
            onToggle={() => onToggleAgent(agent.id)}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

/* ================================================================== */
/*  TAB BAR                                                            */
/* ================================================================== */

function TabBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: { id: string; label: string; icon: React.ReactNode }[]
  activeTab: string
  onTabChange: (id: string) => void
}) {
  return (
    <div role="tablist" className="h-8 flex items-center gap-1 px-3 border-b border-border-default bg-surface shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === tab.id
              ? "bg-surface-raised text-default"
              : "text-muted hover:text-secondary hover:bg-surface-raised/30",
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
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
  const dragging = useRef(false)
  const lastX = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragging.current = true
      lastX.current = e.clientX
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      const delta = e.clientX - lastX.current
      lastX.current = e.clientX
      // For left-edge handle: dragging left = positive resize (panel grows)
      onResize(side === "left" ? -delta : delta)
    },
    [onResize, side],
  )

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  const onPointerCancel = useCallback(() => {
    dragging.current = false
  }, [])

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onReset}
      className={cn(
        "absolute top-0 bottom-0 w-1 z-(--z-dropdown) cursor-col-resize group/resize",
        side === "left" ? "left-0" : "right-0",
      )}
    >
      {/* Visual indicator on hover/drag */}
      <div className="absolute inset-y-0 left-0 w-px bg-transparent group-hover/resize:bg-accent/50 group-active/resize:bg-accent transition-colors" />
    </div>
  )
}

/* ================================================================== */
/*  MAIN PAGE                                                          */
/* ================================================================== */

export default function PrototypePage() {
  const bp = useBreakpoint()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(["1"]))
  const [mainTab, setMainTab] = useState<"chat" | "agents">("chat")
  const [secretsOpen, setSecretsOpen] = useState(false)
  const [agentPanelOpen, setAgentPanelOpen] = useState(true)
  const [leftPanelWidth, setLeftPanelWidth] = useState<number | null>(null)

  // Reset custom width + auto-collapse on breakpoint change
  useEffect(() => {
    setLeftPanelWidth(null)
    if (bp === "S") setAgentPanelOpen(false)
    else if (bp !== "mobile") setAgentPanelOpen(true)
  }, [bp])

  const handleToggleAgent = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleToggleExpandAll = useCallback(() => {
    setExpandedIds((prev) => {
      const allOpen = AGENTS.every((a) => prev.has(a.id))
      if (allOpen) return new Set()
      return new Set(AGENTS.map((a) => a.id))
    })
  }, [])

  // Determine what's visible at each breakpoint
  const showLeftPanel = bp !== "mobile"
  const showTopTabs = bp === "S" || bp === "mobile"

  // Left panel width: custom if user has resized, else breakpoint default
  const defaultLeftWidth = bp === "S" ? 340 : bp === "M" ? 340 : 480
  const effectiveLeftWidth = leftPanelWidth ?? defaultLeftWidth

  const handleLeftPanelResize = useCallback((delta: number) => {
    setLeftPanelWidth((prev) => {
      const current = prev ?? defaultLeftWidth
      return Math.max(280, Math.min(720, current + delta))
    })
  }, [defaultLeftWidth])

  // Top tabs (small screens)
  const topTabs = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: "agents", label: "Agents", icon: <Users className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="h-screen flex bg-surface overflow-hidden">
      <h1 className="sr-only">Agentobox Dashboard</h1>

      {/* Secrets modal */}
      <SecretsModal
        open={secretsOpen}
        onClose={() => setSecretsOpen(false)}
        agents={AGENTS}
      />

      {/* Left panel: collapsed icon rail or open agent cards */}
      {showLeftPanel && (
        <AgentLeftPanel
          agents={AGENTS}
          expandedIds={expandedIds}
          onToggleAgent={handleToggleAgent}
          onToggleExpandAll={handleToggleExpandAll}
          onOpenSecrets={() => setSecretsOpen(true)}
          isOpen={agentPanelOpen}
          onToggleOpen={() => setAgentPanelOpen((p) => !p)}
          width={effectiveLeftWidth}
          onResize={handleLeftPanelResize}
          onResetWidth={() => setLeftPanelWidth(null)}
        />
      )}

      {/* Right side: tabs (on small) + team feed */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Top tabs (S + mobile) */}
        {showTopTabs && (
          <TabBar
            tabs={topTabs}
            activeTab={mainTab}
            onTabChange={(id) => setMainTab(id as "chat" | "agents")}
          />
        )}

        {/* Center: team feed */}
        {(!showTopTabs || mainTab === "chat") && (
          <main className="flex-1 min-w-0 flex flex-col min-h-0">
            <TeamFeed />
          </main>
        )}

        {/* Top-tab content: agents (S + mobile) */}
        {showTopTabs && mainTab === "agents" && (
          <div className="flex-1 min-w-0 bg-surface">
            <AgentCardsPanel
              agents={AGENTS}
              expandedIds={expandedIds}
              onToggleAgent={handleToggleAgent}
            />
          </div>
        )}
      </div>

      {/* Breakpoint indicator */}
      <BreakpointIndicator bp={bp} />
    </div>
  )
}
