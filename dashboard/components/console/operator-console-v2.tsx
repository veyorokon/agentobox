"use client"

import { useState } from "react"
import {
  MOCK_WORK_ITEMS,
  PROJECT_SUMMARY,
  type WorkItem,
  type WorkStatus,
  type ActivityState,
  type WorkArtifact,
  type WorkTask,
} from "@/components/console/mock-data-v2"

/* ================================================================== */
/*  CSS ANIMATIONS                                                     */
/* ================================================================== */

const KEYFRAMES = `
@keyframes breathe {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}
@keyframes pulse-ring {
  0%, 100% { box-shadow: 0 0 0 0 var(--ring-color, transparent); }
  50% { box-shadow: 0 0 0 3px var(--ring-color, transparent); }
}
@keyframes scan-line {
  0% { top: 0; }
  100% { top: 100%; }
}
`

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

const mono = "font-mono"

function statusColor(s: WorkStatus): string {
  const map: Record<WorkStatus, string> = {
    active: "var(--p-success, #8ec07c)", "needs-you": "var(--p-accent, #d5a868)",
    completed: "var(--p-text-muted, #6b7280)", failed: "var(--p-danger, #d86c6c)",
    blocked: "var(--p-warning, #d8b56a)", queued: "var(--p-text-disabled, #4b5563)",
  }
  return map[s]
}

function statusLabel(s: WorkStatus): string {
  const map: Record<WorkStatus, string> = {
    active: "running", "needs-you": "needs you", completed: "done",
    failed: "failed", blocked: "blocked", queued: "queued",
  }
  return map[s]
}

function agentHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return ((h % 360) + 360) % 360
}
function agentColor(name: string) { return `hsl(${agentHue(name)}, 55%, 65%)` }
function agentBg(name: string) { return `hsl(${agentHue(name)}, 35%, 18%)` }
function formatCost(c: number) { return c > 0 ? `$${c.toFixed(2)}` : "\u2014" }

function langBadge(lang?: string) {
  return lang === "py" ? "PY" : lang === "tsx" || lang === "ts" ? "TS" : lang === "js" ? "JS" : ""
}

function kindIcon(kind?: string) {
  return kind === "test" ? "\u2713" : kind === "config" ? "\u2699" : kind === "env" ? "\u26a1" : "\u2192"
}

/* ================================================================== */
/*  AGENT TOKEN                                                        */
/* ================================================================== */

function AgentToken({ name, activity, size = 22 }: { name: string; activity: ActivityState; size?: number }) {
  const color = agentColor(name)
  const bg = agentBg(name)
  const ring = activity === "coding" || activity === "browsing"
    ? { boxShadow: `0 0 0 2px ${color}` }
    : activity === "thinking" || activity === "needs-you"
      ? { animation: "pulse-ring 2s ease-in-out infinite", "--ring-color": activity === "needs-you" ? "var(--p-accent, #d5a868)" : color } as React.CSSProperties
      : activity === "done"
        ? { boxShadow: "0 0 0 1.5px var(--p-text-muted, #6b7280)", opacity: 0.5 }
        : activity === "blocked"
          ? { boxShadow: "0 0 0 2px var(--p-warning, #d8b56a)" }
          : { opacity: 0.4 }

  return (
    <div
      className="relative inline-flex items-center justify-center rounded-full shrink-0"
      style={{ width: size, height: size, backgroundColor: bg, color, fontSize: size * 0.45, fontWeight: 700, fontFamily: "monospace", ...ring }}
    >
      {activity === "done" ? "\u2713" : name[0].toUpperCase()}
      {(activity === "coding" || activity === "thinking") && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full"
          style={{ width: 6, height: 6, backgroundColor: color, animation: activity === "thinking" ? "breathe 2s ease-in-out infinite" : "none" }}
        />
      )}
    </div>
  )
}

/* ================================================================== */
/*  COMMAND BAR                                                        */
/* ================================================================== */

function CommandBar() {
  return (
    <div className="flex items-center gap-4 border-b px-4" style={{ height: 44, borderColor: "var(--p-border-default, #2a2e37)", backgroundColor: "var(--p-surface, #141720)" }}>
      <span className={`${mono} text-[13px] font-semibold tracking-wide`} style={{ color: "var(--p-text-muted, #6b7280)" }}>{PROJECT_SUMMARY.name}</span>
      <div className="h-4 w-px" style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }} />
      <div className={`flex items-center gap-3 ${mono} text-[11px]`}>
        <span style={{ color: "var(--p-text-muted, #6b7280)" }}>{PROJECT_SUMMARY.activeAgents} active</span>
        <span style={{ color: "var(--p-text-muted, #6b7280)" }}>{PROJECT_SUMMARY.completedWork}/{PROJECT_SUMMARY.totalWork} done</span>
        <span style={{ color: "var(--p-text-secondary, #9aa3b0)" }}>{formatCost(PROJECT_SUMMARY.totalCost)}</span>
      </div>
      <div className="flex-1" />
      <div className="flex flex-1 max-w-[520px] items-center gap-2 rounded-md border px-3 py-1.5" style={{ borderColor: "var(--p-border-default, #2a2e37)", backgroundColor: "var(--p-surface-sunken, #0d1017)" }}>
        <span className={`${mono} text-[13px]`} style={{ color: "var(--p-accent, #d5a868)" }}>&rsaquo;</span>
        <span className={`${mono} text-[12px]`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>describe what you want done...</span>
        <span className="inline-block h-[14px] w-[7px] animate-pulse" style={{ backgroundColor: "var(--p-accent, #d5a868)", opacity: 0.7 }} />
      </div>
      <div className="flex-1" />
      <span className={`${mono} text-[10px] uppercase tracking-widest`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>v2 · light embodiment</span>
    </div>
  )
}

/* ================================================================== */
/*  WORK CARD                                                          */
/* ================================================================== */

function WorkCard({ item, selected, onSelect }: { item: WorkItem; selected: boolean; onSelect: () => void }) {
  const done = item.tasks.filter(t => t.status === "done").length
  const total = item.tasks.length
  const pct = total > 0 ? (done / total) * 100 : 0

  return (
    <button type="button" onClick={onSelect} className="w-full text-left rounded-md border px-3 py-2.5 transition-colors"
      style={{ borderColor: selected ? "var(--p-accent, #d5a868)" : "var(--p-border-subtle, #1f2330)", backgroundColor: selected ? "color-mix(in srgb, var(--p-accent, #d5a868) 6%, var(--p-surface, #141720))" : "var(--p-surface, #141720)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${mono} text-[10px] font-bold uppercase tracking-wider`} style={{ color: "var(--p-text-muted, #6b7280)" }}>{item.id}</span>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: statusColor(item.status), boxShadow: item.status === "active" ? `0 0 6px ${statusColor(item.status)}` : "none", animation: item.status === "active" ? "breathe 3s ease-in-out infinite" : "none" }} />
          <span className={`${mono} text-[10px]`} style={{ color: statusColor(item.status) }}>{statusLabel(item.status)}</span>
        </div>
      </div>
      <p className={`${mono} mt-1 text-[12px] font-medium leading-snug`} style={{ color: "var(--p-text-default, #c5cdd8)" }}>{item.title}</p>
      <div className="mt-2 flex items-center gap-2">
        <AgentToken name={item.agent} activity={item.agentActivity} size={18} />
        <span className={`${mono} text-[10px] font-semibold`} style={{ color: agentColor(item.agent) }}>@{item.agent}</span>
        <span className="h-3 w-px" style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }} />
        <span className={`${mono} text-[10px]`} style={{ color: "var(--p-text-muted, #6b7280)" }}>{done}/{total}</span>
        {item.cost > 0 && (<><span className="h-3 w-px" style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }} /><span className={`${mono} text-[10px]`} style={{ color: "var(--p-text-muted, #6b7280)" }}>{formatCost(item.cost)}</span></>)}
      </div>
      {total > 0 && (
        <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: item.status === "completed" ? "var(--p-text-muted, #6b7280)" : statusColor(item.status) }} />
        </div>
      )}
    </button>
  )
}

/* ================================================================== */
/*  WORK STREAM                                                        */
/* ================================================================== */

function WorkStream({ items, selectedId, onSelect }: { items: WorkItem[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex h-full flex-col border-r" style={{ width: 280, borderColor: "var(--p-border-default, #2a2e37)", backgroundColor: "var(--p-surface-sunken, #0d1017)" }}>
      <div className="flex items-center px-3 border-b" style={{ height: 32, borderColor: "var(--p-border-subtle, #1f2330)" }}>
        <span className={`${mono} text-[10px] uppercase tracking-widest font-semibold`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>work stream</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {items.map(item => <WorkCard key={item.id} item={item} selected={item.id === selectedId} onSelect={() => onSelect(item.id)} />)}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  DELEGATION TREE                                                    */
/* ================================================================== */

function TaskNode({ task }: { task: WorkTask }) {
  const color = task.status === "done" ? "var(--p-success, #8ec07c)" : task.status === "active" ? "var(--p-accent, #d5a868)" : task.status === "blocked" ? "var(--p-danger, #d86c6c)" : "var(--p-text-disabled, #4b5563)"
  const activity: ActivityState = task.status === "done" ? "done" : task.status === "active" ? "coding" : task.status === "blocked" ? "blocked" : "idle"

  return (
    <div className="flex items-center gap-1.5 rounded border px-2 py-1"
      style={{ borderColor: task.status === "active" ? color : "var(--p-border-subtle, #1f2330)", backgroundColor: task.status === "active" ? "color-mix(in srgb, var(--p-accent, #d5a868) 6%, transparent)" : "transparent" }}>
      {task.agent && <AgentToken name={task.agent} activity={activity} size={14} />}
      <span className={`${mono} text-[10px]`} style={{ color }}>
        {task.status === "done" ? "\u2713" : task.status === "active" ? "\u25b8" : task.status === "blocked" ? "\u2717" : "\u00b7"}
      </span>
      <span className={`${mono} text-[10px] truncate`} style={{ color: task.status === "done" ? "var(--p-text-muted, #6b7280)" : "var(--p-text-secondary, #9aa3b0)", maxWidth: 140 }}>{task.title}</span>
    </div>
  )
}

function DelegationTree({ item }: { item: WorkItem }) {
  if (item.tasks.length === 0) return null
  return (
    <div className="border-t px-4 py-2" style={{ borderColor: "var(--p-border-subtle, #1f2330)", backgroundColor: "var(--p-surface, #141720)" }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`${mono} text-[9px] uppercase tracking-widest font-bold`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>delegation</span>
        <span className={`${mono} text-[9px]`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>{item.tasks.filter(t => t.status === "done").length}/{item.tasks.length}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {item.tasks.map(task => <TaskNode key={task.id} task={task} />)}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  EXECUTION SURFACE                                                  */
/* ================================================================== */

function ExecutionSurface({ item }: { item: WorkItem }) {
  const isActive = item.status === "active"
  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4" style={{ height: 32, borderColor: "var(--p-border-subtle, #1f2330)" }}>
        <span className={`${mono} text-[10px] uppercase tracking-widest font-semibold`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>execution</span>
        <span className="h-3 w-px" style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }} />
        <AgentToken name={item.agent} activity={item.agentActivity} size={16} />
        <span className={`${mono} text-[11px] font-semibold`} style={{ color: agentColor(item.agent) }}>@{item.agent}</span>
        {isActive && (
          <span className={`${mono} text-[10px] flex items-center gap-1`} style={{ color: "var(--p-success, #8ec07c)" }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--p-success, #8ec07c)", animation: "breathe 2s ease-in-out infinite" }} />
            {item.agentActivity}
          </span>
        )}
        <div className="flex-1" />
        <span className={`${mono} text-[10px]`} style={{ color: "var(--p-text-muted, #6b7280)" }}>{item.turns} turns</span>
        <span className={`${mono} text-[10px]`} style={{ color: "var(--p-text-muted, #6b7280)" }}>{item.elapsed}</span>
      </div>
      <div className="relative flex-1 overflow-y-auto p-4" style={{ backgroundColor: "var(--p-surface-sunken, #0d1017)" }}>
        {isActive && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden" style={{ opacity: 0.04 }}>
            <div className="absolute inset-x-0 h-[1px]" style={{ backgroundColor: "var(--p-success, #8ec07c)", animation: "scan-line 4s linear infinite" }} />
          </div>
        )}
        {item.terminalOutput && item.terminalOutput.length > 0 ? (
          <pre className={`${mono} text-[12px] leading-[1.6] whitespace-pre-wrap`} style={{ color: "var(--p-text-secondary, #9aa3b0)" }}>
            {item.terminalOutput.map((line, i) => {
              const clean = line.replace(/\x1b\[[0-9;]*m/g, "")
              const isDim = line.includes("\x1b[2m")
              const isGreen = line.includes("\x1b[32m")
              const isYellow = line.includes("\x1b[33m")
              return <span key={i} className="block" style={{ color: isGreen ? "var(--p-success, #8ec07c)" : isYellow ? "var(--p-warning, #d8b56a)" : isDim ? "var(--p-text-disabled, #4b5563)" : "var(--p-text-secondary, #9aa3b0)" }}>{clean || "\u00A0"}</span>
            })}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className={`${mono} text-[11px]`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>{item.status === "queued" ? "awaiting execution" : "no output"}</span>
          </div>
        )}
      </div>
      <DelegationTree item={item} />
    </div>
  )
}

/* ================================================================== */
/*  ARTIFACT CARD                                                      */
/* ================================================================== */

function ArtifactCard({ artifact }: { artifact: WorkArtifact }) {
  const actionColor = artifact.action === "created" ? "var(--p-success, #8ec07c)" : artifact.action === "deleted" ? "var(--p-danger, #d86c6c)" : "var(--p-accent, #d5a868)"
  const badge = langBadge(artifact.lang)
  const icon = kindIcon(artifact.kind)
  const filename = artifact.path.split("/").pop() ?? artifact.path

  return (
    <div className="flex items-center gap-2 rounded border px-2 py-1.5" style={{ borderColor: "var(--p-border-subtle, #1f2330)", backgroundColor: "var(--p-surface-sunken, #0d1017)" }}>
      <span className={`${mono} text-[11px] shrink-0`} style={{ color: actionColor }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`${mono} text-[10px] font-semibold truncate`} style={{ color: "var(--p-text-default, #c5cdd8)" }}>{filename}</span>
          {badge && <span className={`${mono} text-[8px] font-bold uppercase rounded px-1 py-px`} style={{ backgroundColor: "var(--p-border-subtle, #1f2330)", color: "var(--p-text-muted, #6b7280)" }}>{badge}</span>}
        </div>
        <span className={`${mono} text-[9px] truncate block`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>{artifact.path}</span>
      </div>
      {artifact.lines && <span className={`${mono} text-[9px] shrink-0`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>{artifact.lines}L</span>}
      <span className={`${mono} text-[9px] shrink-0 font-semibold`} style={{ color: actionColor }}>{artifact.action === "created" ? "new" : artifact.action === "deleted" ? "del" : "mod"}</span>
    </div>
  )
}

/* ================================================================== */
/*  CONTEXT PANEL                                                      */
/* ================================================================== */

function ContextPanel({ item }: { item: WorkItem }) {
  return (
    <div className="flex h-full flex-col border-l" style={{ width: 264, borderColor: "var(--p-border-default, #2a2e37)", backgroundColor: "var(--p-surface, #141720)" }}>
      <div className="flex items-center px-3 border-b" style={{ height: 32, borderColor: "var(--p-border-subtle, #1f2330)" }}>
        <span className={`${mono} text-[10px] uppercase tracking-widest font-semibold`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>context</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {item.goal && (
          <section>
            <h3 className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>goal</h3>
            <p className={`${mono} text-[11px] leading-relaxed`} style={{ color: "var(--p-text-secondary, #9aa3b0)" }}>{item.goal}</p>
          </section>
        )}
        {item.artifacts.length > 0 && (
          <section>
            <h3 className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>artifacts</h3>
            <div className="space-y-1">{item.artifacts.map((a, i) => <ArtifactCard key={i} artifact={a} />)}</div>
          </section>
        )}
        <section>
          <h3 className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>cost</h3>
          <div className="flex items-baseline gap-2">
            <span className={`${mono} text-[18px] font-bold tabular-nums`} style={{ color: "var(--p-text-default, #c5cdd8)" }}>{formatCost(item.cost)}</span>
            <span className={`${mono} text-[10px]`} style={{ color: "var(--p-text-muted, #6b7280)" }}>{item.turns} turns / {item.elapsed}</span>
          </div>
        </section>
        {item.observations && item.observations.length > 0 && (
          <section>
            <h3 className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`} style={{ color: "var(--p-text-disabled, #4b5563)" }}>observations</h3>
            <div className="space-y-1.5">
              {item.observations.map((o, i) => <p key={i} className={`${mono} text-[10px] leading-relaxed`} style={{ color: "var(--p-text-muted, #6b7280)" }}>{o}</p>)}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  INTERVENTION BAR                                                   */
/* ================================================================== */

function InterventionBar({ items }: { items: WorkItem[] }) {
  const needsYou = items.filter(i => i.intervention)
  if (needsYou.length === 0) return null
  const item = needsYou[0]
  const inv = item.intervention!

  return (
    <div className="flex items-center gap-3 border-t px-4" style={{ height: 42, borderColor: "var(--p-accent, #d5a868)", backgroundColor: "color-mix(in srgb, var(--p-accent, #d5a868) 5%, var(--p-surface, #141720))" }}>
      <AgentToken name={item.agent} activity="needs-you" size={20} />
      <span className={`${mono} text-[10px] font-bold uppercase tracking-wider`} style={{ color: "var(--p-accent, #d5a868)" }}>{item.id}</span>
      <span className={`${mono} text-[11px]`} style={{ color: "var(--p-text-secondary, #9aa3b0)" }}>{inv.type}:</span>
      <span className={`${mono} text-[11px] flex-1 truncate`} style={{ color: "var(--p-text-default, #c5cdd8)" }}>{inv.summary}</span>
      {inv.options?.map(opt => (
        <button key={opt} type="button" className={`${mono} rounded border px-3 py-1 text-[10px] font-semibold transition-colors hover:brightness-110`}
          style={{ borderColor: opt === "Allow" || opt === "Approve" ? "var(--p-success, #8ec07c)" : "var(--p-border-default, #2a2e37)", color: opt === "Allow" || opt === "Approve" ? "var(--p-success, #8ec07c)" : "var(--p-text-muted, #6b7280)", backgroundColor: "transparent" }}>
          {opt}
        </button>
      ))}
    </div>
  )
}

/* ================================================================== */
/*  MAIN                                                               */
/* ================================================================== */

export function OperatorConsoleV2() {
  const [selectedId, setSelectedId] = useState(MOCK_WORK_ITEMS[0].id)
  const selected = MOCK_WORK_ITEMS.find(i => i.id === selectedId) ?? MOCK_WORK_ITEMS[0]

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      <div className="flex h-screen flex-col overflow-hidden" style={{ backgroundColor: "var(--p-surface, #141720)" }}>
        <CommandBar />
        <div className="flex flex-1 min-h-0">
          <WorkStream items={MOCK_WORK_ITEMS} selectedId={selectedId} onSelect={setSelectedId} />
          <ExecutionSurface item={selected} />
          <ContextPanel item={selected} />
        </div>
        <InterventionBar items={MOCK_WORK_ITEMS} />
      </div>
    </>
  )
}
