"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUp,
  Users,
  MessageSquare,
  ChevronRight,
  Check,
  X,
  AlertCircle,
  Plus,
  Code,
  Terminal,
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
} from "lucide-react"
import { cn, agentHue, formatCost } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible } from "@/components/ui/collapsible"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"

/* ================================================================== */
/*  FAKE DATA                                                          */
/* ================================================================== */

type FakeAgent = {
  id: string
  name: string
  status: "running" | "error" | "idle" | "stopped" | "waiting"
  task: string
  cost: number
  duration: string
  model: string
  turns: number
  lastOutput: string
  phase?: string
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
}

const PILL_CONFIG = [
  { key: "error" as const, dot: "bg-danger", text: "text-danger" },
  { key: "running" as const, dot: "bg-success", text: "text-success", animate: true },
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
    window.addEventListener("resize", calc)
    return () => window.removeEventListener("resize", calc)
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

/** 1. User message — right-aligned bubble */
function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end py-1">
      <div className="max-w-[80%]">
        <div className="bg-accent/15 border border-accent/20 rounded px-3 py-1.5">
          <p className="text-default text-sm whitespace-pre-wrap leading-relaxed">
            {text}
          </p>
        </div>
      </div>
    </div>
  )
}

/** 2. Assistant message with markdown — left-aligned with avatar */
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

/** 9. Activity summary line — inline collapsed */
function ActivitySummary({
  agent,
  text,
  tools,
}: {
  agent: string
  text: string
  tools: number
}) {
  return (
    <div className="ml-8">
      <div className="inline-flex items-center gap-2 border-l-2 border-l-muted/40 rounded-r px-2.5 py-1 hover:bg-surface-sunken/40 transition-colors cursor-pointer">
        <ChevronRight size={12} className="shrink-0 text-muted" />
        <AgentAvatar name={agent} size="sm" />
        <span className="text-xs text-secondary font-medium">{agent}</span>
        <span className="text-xs text-muted font-mono truncate">{text}</span>
        {tools > 0 && (
          <span className="text-[10px] text-muted/60 font-mono shrink-0">
            (+{tools} tools)
          </span>
        )}
      </div>
    </div>
  )
}

/** 10. Thinking indicator — pulsing dots */
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

  const activeAgents = agents.filter((a) => a.status === "running" || a.status === "idle")
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
    <div className="fixed inset-0 z-(--z-overlay) flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 rounded-xl border border-border-default bg-surface-raised shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted" />
              <h2 className="text-sm font-semibold text-default">Project Secrets</h2>
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
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
/*  HEADER BAR                                                         */
/* ================================================================== */

function HeaderBar({
  onToggleSidebar,
  onOpenSecrets,
  selectedAgent,
  agents,
  showSidebarToggle = true,
}: {
  onToggleSidebar: () => void
  onOpenSecrets: () => void
  selectedAgent: FakeAgent | null
  agents: FakeAgent[]
  showSidebarToggle?: boolean
}) {
  const totalCost = agents.reduce((sum, a) => sum + a.cost, 0)

  return (
    <div className="h-12 border-b border-border-default bg-surface-sunken px-4 flex items-center gap-4 shrink-0">
      {/* Left: sidebar toggle + project name + secrets */}
      <div className="flex items-center gap-2">
        {showSidebarToggle && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
        <span className="text-sm font-medium text-default">agentobox</span>
        <button
          type="button"
          onClick={onOpenSecrets}
          className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
          title="Project secrets"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Center: selected agent indicator */}
      <div className="flex-1 flex items-center justify-center">
        {selectedAgent ? (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-raised/50 text-xs">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                selectedAgent.status === "running" && "bg-success animate-breathe text-success",
                selectedAgent.status === "error" && "bg-danger",
                selectedAgent.status === "idle" && "bg-info",
                selectedAgent.status === "stopped" && "bg-muted/50",
                selectedAgent.status === "waiting" && "bg-warning",
              )}
            />
            <span className="font-medium text-default">{selectedAgent.name}</span>
            <span className="text-muted">&middot;</span>
            <span className="text-muted font-mono">{selectedAgent.model}</span>
            <span
              className={cn(
                "text-[10px] capitalize",
                STATUS_CONFIG[selectedAgent.status]?.text ?? "text-muted",
              )}
            >
              {selectedAgent.status}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted">
            All agents ({agents.length})
          </span>
        )}
      </div>

      {/* Right: total cost */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted font-mono">
          {formatCost(totalCost)}
        </span>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  SESSION INFO BAR                                                   */
/* ================================================================== */

function SessionInfoBar({ agent }: { agent: FakeAgent | null }) {
  if (!agent) return null

  const items = [
    agent.model,
    "47 tools",
    formatCost(agent.cost),
    `${agent.turns} turn${agent.turns === 1 ? "" : "s"}`,
    "default",
    agent.phase,
  ].filter(Boolean)

  return (
    <div className="h-8 border-b border-border-default bg-surface px-4 flex items-center gap-2 shrink-0">
      {items.map((item, i) => (
        <span key={i} className="text-xs text-muted flex items-center gap-2">
          {i > 0 && <span className="text-muted">&middot;</span>}
          <span className="font-mono">{item}</span>
        </span>
      ))}
    </div>
  )
}

/* ================================================================== */
/*  COMPOSER BAR                                                       */
/* ================================================================== */

function ComposerBar({ selectedAgent }: { selectedAgent: FakeAgent | null }) {
  const placeholder = selectedAgent
    ? `Message ${selectedAgent.name}...`
    : "Message team lead... (type @ to target)"

  return (
    <div className="px-6 pb-4 pt-2 max-w-3xl mx-auto w-full shrink-0">
      <div className="relative rounded-2xl border-[0.5px] border-border-default bg-surface-raised/60">
        {/* Text input */}
        <textarea
          readOnly
          placeholder={placeholder}
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
              <Code className="h-3 w-3" />
              Normal
            </span>
            {selectedAgent && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-sunken text-xs text-secondary font-medium">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    selectedAgent.status === "running" ? "bg-success" : selectedAgent.status === "idle" ? "bg-info" : "bg-muted",
                  )}
                />
                {selectedAgent.name}
              </span>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted tabular-nums">$0.30</span>
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
/*  CHAT FEED                                                          */
/* ================================================================== */

function ChatFeed({ selectedAgent }: { selectedAgent: FakeAgent | null }) {
  return (
    <div className="flex flex-col h-full min-w-0">
      <SessionInfoBar agent={selectedAgent} />

      <ScrollArea className="flex-1 overflow-y-auto dotted-grid">
        <div className="max-w-3xl mx-auto w-full px-6 py-4 space-y-3">
          {/* 6. System init message */}
          <SystemMessage text="Opus 4.6 · 47 tools" />
          <SystemMessage text="session initialized" />

          {/* 1. User message */}
          <UserMessage text="Fix the JWT validation bug in auth.ts. The token expiry check is off by one hour." />

          {/* 2. Assistant message with markdown */}
          <AssistantMessage
            agent="backend"
            content={FAKE_MARKDOWN}
          />

          {/* 3. Single tool call */}
          <SingleToolRow toolName="Read" summary="src/auth.ts" />

          {/* 9. Activity summary */}
          <ActivitySummary
            agent="frontend"
            text="Reading component styles"
            tools={2}
          />

          {/* 2b. Assistant follow-up (no avatar — same agent) */}
          <AssistantMessage
            agent="backend"
            content="I've applied the fix. Let me also run the linter and verify the tests pass."
            showAvatar={false}
          />

          {/* 3b. Multi-tool group */}
          <MultiToolGroup
            tools={[
              { name: "Edit", summary: "src/auth.ts" },
              { name: "Bash", summary: "npm run lint" },
              { name: "Bash", summary: "npm test -- --filter auth" },
            ]}
          />

          {/* 7. AskUserQuestion card */}
          <QuestionCard
            agent="backend"
            question="The fix is ready. How should I handle the clock skew tolerance?"
            options={[
              "30 seconds (Recommended)",
              "60 seconds",
              "No tolerance",
              "Configurable via env var",
            ]}
          />

          {/* 1b. User reply */}
          <UserMessage text="Go with 30 seconds. That's the standard." />

          {/* 5. Error bubble */}
          <ErrorBubble
            agent="qa"
            text={"npm test failed: FAIL src/auth.test.ts\n\nExpected: 200\nReceived: 401\n\nThe auth.ts fix hasn't landed in the test environment yet."}
          />

          {/* 10. Thinking indicator */}
          <div className="flex gap-2 min-w-0">
            <ChatAvatar name="backend" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-muted font-mono mb-0.5">backend</div>
              <ThinkingIndicator label="Applying clock skew fix..." />
            </div>
          </div>

          {/* 4. Result pill */}
          <ResultPill
            cost={0.12}
            duration="3m 22s"
            turns={8}
            model="Opus 4.6"
          />

          {/* 8. Todo list */}
          <TodoList
            agent="backend"
            tasks={[
              { text: "Read auth.ts and identify the bug", done: true },
              { text: "Fix Date.now() → seconds conversion", done: true },
              { text: "Add 30s clock skew tolerance", done: true },
              { text: "Run linter", done: true },
              { text: "Run auth test suite", done: false },
              { text: "Update error logging", done: false },
            ]}
          />

          {/* 6b. Status message */}
          <SystemMessage text="backend session complete · 8 turns · $0.12" />
        </div>
      </ScrollArea>

      <ComposerBar selectedAgent={selectedAgent} />
    </div>
  )
}

/* ================================================================== */
/*  ROSTER PANEL                                                       */
/* ================================================================== */

function RosterPanel({
  collapsed,
  onToggle,
  agents,
  selectedAgentId,
  onSelectAgent,
}: {
  collapsed: boolean
  onToggle: () => void
  agents: FakeAgent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
}) {
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { running: 0, error: 0, idle: 0, stopped: 0, waiting: 0 }
    for (const a of agents) counts[a.status] = (counts[a.status] ?? 0) + 1
    return counts
  }, [agents])

  return (
    <div
      className="h-full bg-surface-sunken border-r-[0.5px] border-border-default flex flex-col overflow-hidden shrink-0"
      style={{
        width: collapsed ? 60 : 260,
        minWidth: collapsed ? 60 : 260,
        transition: "width 200ms ease, min-width 200ms ease",
      }}
    >
      <div className="flex-1 flex flex-col bg-surface min-h-0">
        {/* Header — h-8 to align with session info bar + right panel tab bar */}
        <div className={cn(
          "h-8 px-3 flex items-center border-b border-border-default shrink-0",
          collapsed && "justify-center px-1.5",
        )}>
          {!collapsed && (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Agents
              </span>
              <div className="flex items-center gap-1.5 ml-1">
                {PILL_CONFIG.map(
                  (pill) =>
                    (statusCounts[pill.key] ?? 0) > 0 && (
                      <span
                        key={pill.key}
                        className={cn(
                          "inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums",
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
                    ),
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
            aria-label={collapsed ? "Expand roster" : "Collapse roster"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Agent list */}
        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="flex flex-col pt-1.5 pb-2">
            {/* All agents button */}
            {!collapsed && (
              <button
                type="button"
                onClick={() => onSelectAgent(null)}
                className={cn(
                  "mx-1.5 rounded-lg transition-all duration-(--duration-normal) text-left px-3 py-2",
                  "border-l-2 border-transparent",
                  selectedAgentId === null
                    ? "bg-surface-raised/80 border-l-accent"
                    : "hover:bg-surface-raised/30",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                  <span
                    className={cn(
                      "text-[13px] font-medium",
                      selectedAgentId === null ? "text-default" : "text-secondary",
                    )}
                  >
                    All agents
                  </span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-muted tabular-nums font-mono">
                    {agents.length}
                  </span>
                </div>
              </button>
            )}

            {agents.map((agent) => {
              const config = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.stopped
              const isSelected = selectedAgentId === agent.id
              const isRunning = agent.status === "running"
              const isError = agent.status === "error"
              const isStopped = agent.status === "stopped"

              if (collapsed) {
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => onSelectAgent(agent.id)}
                    className={cn(
                      "mx-auto my-0.5 relative group",
                      isStopped && "opacity-55",
                    )}
                    title={agent.name}
                  >
                    <AgentAvatar name={agent.name} size="md" stopped={isStopped} />
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface",
                        config.dot,
                        isRunning && "animate-breathe text-success",
                      )}
                    />
                    {isSelected && (
                      <span className="absolute inset-0 rounded-md ring-2 ring-accent/50" />
                    )}
                  </button>
                )
              }

              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onSelectAgent(agent.id)}
                  className={cn(
                    "group mx-1.5 rounded-lg transition-all duration-(--duration-normal) text-left",
                    "border-l-2 border-transparent",
                    isSelected && "bg-surface-raised/80 border-l-accent",
                    !isSelected && "hover:bg-surface-raised/30",
                    isError && !isSelected && "hover:bg-danger-subtle",
                    isError && isSelected && "bg-danger-subtle/60 border-l-danger",
                    isStopped && "opacity-55",
                    isRunning && !isSelected && "animate-border-pulse",
                  )}
                >
                  <div className="flex items-start gap-2 px-2.5 py-2">
                    <AgentAvatar name={agent.name} stopped={isStopped} />
                    <div className="flex-1 min-w-0">
                      {/* Row 1: status dot + name + meta */}
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full shrink-0",
                            config.dot,
                            isRunning && "animate-breathe text-success",
                          )}
                        />
                        <span
                          className={cn(
                            "text-[13px] font-medium truncate",
                            isSelected ? "text-default" : "text-secondary",
                            isStopped && "text-muted",
                          )}
                        >
                          {agent.name}
                        </span>
                        <span className="flex-1" />
                        {isError ? (
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-danger shrink-0">
                            err
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted/60 shrink-0 tabular-nums font-mono">
                            {agent.duration}
                          </span>
                        )}
                      </div>
                      {/* Row 2: activity + cost */}
                      <div className="flex items-center gap-1 mt-px">
                        <span
                          className={cn(
                            "text-[11px] truncate flex-1 leading-tight",
                            isError ? "text-danger/80" : "text-muted/70",
                          )}
                        >
                          {agent.task}
                        </span>
                        {agent.cost > 0 && (
                          <span className="text-[9px] text-muted/50 font-mono shrink-0 tabular-nums">
                            {formatCost(agent.cost)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </ScrollArea>

        {/* Bottom bar */}
        <div className="px-3 py-2 flex items-center shrink-0 border-t border-border-default">
          {!collapsed && (
            <span className="text-[11px] text-muted truncate">vahid@agentobox</span>
          )}
        </div>
      </div>
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

/** Unified agent card: info + VNC preview side by side */
function AgentCardRow({
  agent,
  isSelected,
  onSelect,
  compact = false,
}: {
  agent: FakeAgent
  isSelected: boolean
  onSelect: () => void
  compact?: boolean
}) {
  const config = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.stopped
  const isRunning = agent.status === "running"
  const isError = agent.status === "error"
  const isStopped = agent.status === "stopped"

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg border transition-all duration-(--duration-normal)",
        isSelected
          ? "border-accent/40 bg-surface-raised/80 shadow-sm"
          : "border-border-subtle bg-surface hover:bg-surface-raised/40 hover:border-border-default",
        isError && "border-danger/30",
        isStopped && "opacity-60",
      )}
    >
      <div className={cn("grid gap-2", compact ? "grid-cols-1 p-2.5" : "grid-cols-2 p-3")}>
        {/* Left: agent info */}
        <div className="min-w-0 flex flex-col">
          {/* Header: avatar + name + status */}
          <div className="flex items-center gap-2 mb-1.5">
            <AgentAvatar name={agent.name} stopped={isStopped} />
            <span
              className={cn(
                "text-[13px] font-medium flex-1 truncate",
                isStopped ? "text-muted" : "text-default",
              )}
            >
              {agent.name}
            </span>
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                config.dot,
                isRunning && "animate-breathe text-success",
              )}
            />
          </div>

          {/* Current task */}
          <div className="flex items-start gap-1.5 mb-1">
            <Terminal className="h-3 w-3 text-muted/60 shrink-0 mt-0.5" />
            <span className="text-[11px] text-secondary leading-tight truncate">
              {agent.task}
            </span>
          </div>

          {/* Last output */}
          <div className="rounded bg-surface-sunken/60 px-1.5 py-1 mb-1.5 flex-1">
            <p className="text-[10px] text-muted font-mono leading-relaxed line-clamp-2 whitespace-pre-wrap">
              {agent.lastOutput}
            </p>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-2 text-[9px] text-muted font-mono tabular-nums flex-wrap">
            <span className="inline-flex items-center gap-0.5">
              <DollarSign className="h-2.5 w-2.5" />
              {formatCost(agent.cost)}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {agent.duration}
            </span>
            <span className="text-muted/50">&middot;</span>
            <span>{agent.model}</span>
          </div>
        </div>

        {/* Right: VNC thumbnail */}
        <VncThumbnail agent={agent} />
      </div>
    </button>
  )
}

function AgentCardsPanel({
  agents,
  selectedAgentId,
  onSelectAgent,
  compact = false,
}: {
  agents: FakeAgent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string) => void
  compact?: boolean
}) {
  return (
    <ScrollArea className="h-full overflow-y-auto">
      <div className="p-3 space-y-2">
        {agents.map((agent) => (
          <AgentCardRow
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onSelect={() => onSelectAgent(agent.id)}
            compact={compact}
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
    <div className="h-8 flex items-center gap-1 px-3 border-b border-border-default bg-surface shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
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
  side = "left",
}: {
  onResize: (delta: number) => void
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

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
  const [rosterCollapsed, setRosterCollapsed] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>("1")
  const [mainTab, setMainTab] = useState<"chat" | "agents">("chat")
  const [secretsOpen, setSecretsOpen] = useState(false)
  const [rightPanelWidth, setRightPanelWidth] = useState<number | null>(null)

  // Auto-collapse roster at M breakpoint
  useEffect(() => {
    if (bp === "M") setRosterCollapsed(true)
    if (bp === "L" || bp === "XL") setRosterCollapsed(false)
  }, [bp])

  // Reset custom width when breakpoint changes
  useEffect(() => {
    setRightPanelWidth(null)
  }, [bp])

  const selectedAgent = useMemo(
    () => AGENTS.find((a) => a.id === selectedAgentId) ?? null,
    [selectedAgentId],
  )

  const handleSelectAgent = useCallback((id: string | null) => {
    setSelectedAgentId(id)
  }, [])

  // Determine what's visible at each breakpoint
  const showRoster = bp !== "mobile"
  const showRightPanel = bp === "XL" || bp === "L" || bp === "M"
  const showTopTabs = bp === "S" || bp === "mobile"

  // Right panel width: custom if user has resized, else breakpoint default
  const defaultRightWidth = bp === "M" ? 340 : 480
  const effectiveRightWidth = rightPanelWidth ?? defaultRightWidth
  // Compact mode when panel is narrow enough that side-by-side doesn't work
  const compactCards = effectiveRightWidth < 400

  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth((prev) => {
      const current = prev ?? defaultRightWidth
      // Clamp between 280 and 720
      return Math.max(280, Math.min(720, current + delta))
    })
  }, [defaultRightWidth])

  // Top tabs (small screens — no separate Screen tab since VNC is inline with agents)
  const topTabs = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: "agents", label: "Agents", icon: <Users className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      {/* Header bar */}
      <HeaderBar
        onToggleSidebar={() => setRosterCollapsed((c) => !c)}
        onOpenSecrets={() => setSecretsOpen(true)}
        selectedAgent={selectedAgent}
        agents={AGENTS}
        showSidebarToggle={showRoster}
      />

      {/* Secrets modal */}
      <SecretsModal
        open={secretsOpen}
        onClose={() => setSecretsOpen(false)}
        agents={AGENTS}
      />

      {/* Top tabs (S + mobile) */}
      {showTopTabs && (
        <TabBar
          tabs={topTabs}
          activeTab={mainTab}
          onTabChange={(id) => setMainTab(id as "chat" | "agents")}
        />
      )}

      {/* Main layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Roster */}
        {showRoster && (
          <RosterPanel
            collapsed={rosterCollapsed || bp === "M"}
            onToggle={() => setRosterCollapsed((c) => !c)}
            agents={AGENTS}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleSelectAgent}
          />
        )}

        {/* Center: chat feed */}
        {(!showTopTabs || mainTab === "chat") && (
          <div className="flex-1 min-w-0 flex flex-col">
            <ChatFeed selectedAgent={selectedAgent} />
          </div>
        )}

        {/* Right panel: unified agent cards with inline VNC */}
        {showRightPanel && (
          <div
            className="relative border-l border-border-default bg-surface flex flex-col shrink-0"
            style={{
              width: effectiveRightWidth,
              minWidth: effectiveRightWidth,
            }}
          >
            <ResizeHandle onResize={handleRightPanelResize} side="left" />
            <PanelHeader>
              <div className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Agent Activity
                </span>
              </div>
            </PanelHeader>
            <AgentCardsPanel
              agents={AGENTS}
              selectedAgentId={selectedAgentId}
              onSelectAgent={(id) => setSelectedAgentId(id)}
              compact={compactCards}
            />
          </div>
        )}

        {/* Top-tab content: agents (S + mobile) */}
        {showTopTabs && mainTab === "agents" && (
          <div className="flex-1 min-w-0 bg-surface">
            <AgentCardsPanel
              agents={AGENTS}
              selectedAgentId={selectedAgentId}
              onSelectAgent={(id) => setSelectedAgentId(id)}
            />
          </div>
        )}
      </div>

      {/* Breakpoint indicator */}
      <BreakpointIndicator bp={bp} />
    </div>
  )
}
