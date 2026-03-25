"use client"

import { useState } from "react"
import {
  MOCK_WORK_ITEMS,
  PROJECT_SUMMARY,
  type WorkItem,
  type WorkStatus,
} from "@/components/console/mock-data"

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

const mono = "font-mono"

function statusColor(status: WorkStatus): string {
  switch (status) {
    case "active": return "var(--p-success, #8ec07c)"
    case "needs-you": return "var(--p-accent, #d5a868)"
    case "completed": return "var(--p-text-muted, #6b7280)"
    case "failed": return "var(--p-danger, #d86c6c)"
    case "blocked": return "var(--p-warning, #d8b56a)"
    case "queued": return "var(--p-text-disabled, #4b5563)"
  }
}

function statusLabel(status: WorkStatus): string {
  switch (status) {
    case "active": return "running"
    case "needs-you": return "needs you"
    case "completed": return "done"
    case "failed": return "failed"
    case "blocked": return "blocked"
    case "queued": return "queued"
  }
}

function agentHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return ((hash % 360) + 360) % 360
}

function agentColor(name: string): string {
  return `hsl(${agentHue(name)}, 55%, 65%)`
}

function formatCost(cost: number): string {
  return cost > 0 ? `$${cost.toFixed(2)}` : "—"
}

/* ================================================================== */
/*  COMMAND BAR                                                        */
/* ================================================================== */

function CommandBar() {
  return (
    <div
      className="flex items-center gap-4 border-b px-4"
      style={{
        height: 44,
        borderColor: "var(--p-border-default, #2a2e37)",
        backgroundColor: "var(--p-surface, #141720)",
      }}
    >
      <span
        className={`${mono} text-[13px] font-semibold tracking-wide`}
        style={{ color: "var(--p-text-muted, #6b7280)" }}
      >
        {PROJECT_SUMMARY.name}
      </span>

      <div
        className="h-4 w-px"
        style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }}
      />

      <div className={`flex items-center gap-3 ${mono} text-[11px]`}>
        <span style={{ color: "var(--p-text-muted, #6b7280)" }}>
          {PROJECT_SUMMARY.activeAgents} active
        </span>
        <span style={{ color: "var(--p-text-muted, #6b7280)" }}>
          {PROJECT_SUMMARY.completedWork}/{PROJECT_SUMMARY.totalWork} done
        </span>
        <span style={{ color: "var(--p-text-secondary, #9aa3b0)" }}>
          {formatCost(PROJECT_SUMMARY.totalCost)}
        </span>
      </div>

      <div className="flex-1" />

      {/* Command input */}
      <div
        className="flex flex-1 max-w-[520px] items-center gap-2 rounded-md border px-3 py-1.5"
        style={{
          borderColor: "var(--p-border-default, #2a2e37)",
          backgroundColor: "var(--p-surface-sunken, #0d1017)",
        }}
      >
        <span
          className={`${mono} text-[13px]`}
          style={{ color: "var(--p-accent, #d5a868)" }}
        >
          &rsaquo;
        </span>
        <span
          className={`${mono} text-[12px]`}
          style={{ color: "var(--p-text-disabled, #4b5563)" }}
        >
          describe what you want done...
        </span>
        <span
          className="inline-block h-[14px] w-[7px] animate-pulse"
          style={{ backgroundColor: "var(--p-accent, #d5a868)", opacity: 0.7 }}
        />
      </div>

      <div className="flex-1" />

      <span
        className={`${mono} text-[10px] uppercase tracking-widest`}
        style={{ color: "var(--p-text-disabled, #4b5563)" }}
      >
        operator console
      </span>
    </div>
  )
}

/* ================================================================== */
/*  WORK CARD                                                          */
/* ================================================================== */

function WorkCard({
  item,
  selected,
  onSelect,
}: {
  item: WorkItem
  selected: boolean
  onSelect: () => void
}) {
  const done = item.tasks.filter(t => t.status === "done").length
  const total = item.tasks.length
  const progressPct = total > 0 ? (done / total) * 100 : 0

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left rounded-md border px-3 py-2.5 transition-colors"
      style={{
        borderColor: selected
          ? "var(--p-accent, #d5a868)"
          : "var(--p-border-subtle, #1f2330)",
        backgroundColor: selected
          ? "color-mix(in srgb, var(--p-accent, #d5a868) 6%, var(--p-surface, #141720))"
          : "var(--p-surface, #141720)",
      }}
    >
      {/* Header: ID + status */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`${mono} text-[10px] font-bold uppercase tracking-wider`}
          style={{ color: "var(--p-text-muted, #6b7280)" }}
        >
          {item.id}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: statusColor(item.status),
              boxShadow: item.status === "active"
                ? `0 0 6px ${statusColor(item.status)}`
                : "none",
            }}
          />
          <span
            className={`${mono} text-[10px]`}
            style={{ color: statusColor(item.status) }}
          >
            {statusLabel(item.status)}
          </span>
        </div>
      </div>

      {/* Title */}
      <p
        className={`${mono} mt-1 text-[12px] font-medium leading-snug`}
        style={{ color: "var(--p-text-default, #c5cdd8)" }}
      >
        {item.title}
      </p>

      {/* Agent + metrics */}
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`${mono} text-[10px] font-semibold`}
          style={{ color: agentColor(item.agent) }}
        >
          @{item.agent}
        </span>
        <span
          className="h-3 w-px"
          style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }}
        />
        <span
          className={`${mono} text-[10px]`}
          style={{ color: "var(--p-text-muted, #6b7280)" }}
        >
          {done}/{total}
        </span>
        {item.cost > 0 && (
          <>
            <span
              className="h-3 w-px"
              style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }}
            />
            <span
              className={`${mono} text-[10px]`}
              style={{ color: "var(--p-text-muted, #6b7280)" }}
            >
              {formatCost(item.cost)}
            </span>
          </>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div
          className="mt-2 h-[2px] w-full overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progressPct}%`,
              backgroundColor: item.status === "completed"
                ? "var(--p-text-muted, #6b7280)"
                : statusColor(item.status),
            }}
          />
        </div>
      )}
    </button>
  )
}

/* ================================================================== */
/*  WORK STREAM (left column)                                          */
/* ================================================================== */

function WorkStream({
  items,
  selectedId,
  onSelect,
}: {
  items: WorkItem[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div
      className="flex h-full flex-col border-r"
      style={{
        width: 280,
        borderColor: "var(--p-border-default, #2a2e37)",
        backgroundColor: "var(--p-surface-sunken, #0d1017)",
      }}
    >
      <div
        className="flex items-center px-3 border-b"
        style={{
          height: 32,
          borderColor: "var(--p-border-subtle, #1f2330)",
        }}
      >
        <span
          className={`${mono} text-[10px] uppercase tracking-widest font-semibold`}
          style={{ color: "var(--p-text-disabled, #4b5563)" }}
        >
          work stream
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {items.map(item => (
          <WorkCard
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={() => onSelect(item.id)}
          />
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  EXECUTION SURFACE (center)                                         */
/* ================================================================== */

function ExecutionSurface({ item }: { item: WorkItem }) {
  return (
    <div className="flex h-full flex-1 flex-col">
      {/* Execution header */}
      <div
        className="flex items-center gap-3 border-b px-4"
        style={{
          height: 32,
          borderColor: "var(--p-border-subtle, #1f2330)",
        }}
      >
        <span
          className={`${mono} text-[10px] uppercase tracking-widest font-semibold`}
          style={{ color: "var(--p-text-disabled, #4b5563)" }}
        >
          execution
        </span>
        <span
          className="h-3 w-px"
          style={{ backgroundColor: "var(--p-border-subtle, #1f2330)" }}
        />
        <span
          className={`${mono} text-[11px] font-semibold`}
          style={{ color: agentColor(item.agent) }}
        >
          @{item.agent}
        </span>
        <span
          className={`${mono} text-[10px]`}
          style={{ color: "var(--p-text-muted, #6b7280)" }}
        >
          {item.executionType}
        </span>
        <div className="flex-1" />
        <span
          className={`${mono} text-[10px]`}
          style={{ color: "var(--p-text-muted, #6b7280)" }}
        >
          {item.turns} turns
        </span>
        <span
          className={`${mono} text-[10px]`}
          style={{ color: "var(--p-text-muted, #6b7280)" }}
        >
          {item.elapsed}
        </span>
      </div>

      {/* Terminal output area */}
      <div
        className="flex-1 overflow-y-auto p-4"
        style={{ backgroundColor: "var(--p-surface-sunken, #0d1017)" }}
      >
        {item.terminalOutput && item.terminalOutput.length > 0 ? (
          <pre
            className={`${mono} text-[12px] leading-[1.6] whitespace-pre-wrap`}
            style={{ color: "var(--p-text-secondary, #9aa3b0)" }}
          >
            {item.terminalOutput.map((line, i) => {
              // Strip ANSI for this static mockup — render with style hints
              const clean = line.replace(/\x1b\[[0-9;]*m/g, "")
              const isDim = line.includes("\x1b[2m")
              const isGreen = line.includes("\x1b[32m")
              const isYellow = line.includes("\x1b[33m")
              return (
                <span
                  key={i}
                  className="block"
                  style={{
                    color: isGreen
                      ? "var(--p-success, #8ec07c)"
                      : isYellow
                        ? "var(--p-warning, #d8b56a)"
                        : isDim
                          ? "var(--p-text-disabled, #4b5563)"
                          : "var(--p-text-secondary, #9aa3b0)",
                  }}
                >
                  {clean || "\u00A0"}
                </span>
              )
            })}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center">
            <span
              className={`${mono} text-[11px]`}
              style={{ color: "var(--p-text-disabled, #4b5563)" }}
            >
              {item.status === "queued" ? "awaiting execution" : "no output"}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  CONTEXT PANEL (right column)                                       */
/* ================================================================== */

function ContextPanel({ item }: { item: WorkItem }) {
  return (
    <div
      className="flex h-full flex-col border-l"
      style={{
        width: 264,
        borderColor: "var(--p-border-default, #2a2e37)",
        backgroundColor: "var(--p-surface, #141720)",
      }}
    >
      <div
        className="flex items-center px-3 border-b"
        style={{
          height: 32,
          borderColor: "var(--p-border-subtle, #1f2330)",
        }}
      >
        <span
          className={`${mono} text-[10px] uppercase tracking-widest font-semibold`}
          style={{ color: "var(--p-text-disabled, #4b5563)" }}
        >
          context
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Goal */}
        {item.goal && (
          <section>
            <h3
              className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`}
              style={{ color: "var(--p-text-disabled, #4b5563)" }}
            >
              goal
            </h3>
            <p
              className={`${mono} text-[11px] leading-relaxed`}
              style={{ color: "var(--p-text-secondary, #9aa3b0)" }}
            >
              {item.goal}
            </p>
          </section>
        )}

        {/* Task tree */}
        <section>
          <h3
            className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`}
            style={{ color: "var(--p-text-disabled, #4b5563)" }}
          >
            tasks
          </h3>
          <div className="space-y-1">
            {item.tasks.map(task => (
              <div key={task.id} className="flex items-start gap-2">
                <span
                  className={`${mono} text-[11px] shrink-0`}
                  style={{
                    color: task.status === "done"
                      ? "var(--p-success, #8ec07c)"
                      : task.status === "active"
                        ? "var(--p-accent, #d5a868)"
                        : task.status === "blocked"
                          ? "var(--p-danger, #d86c6c)"
                          : "var(--p-text-disabled, #4b5563)",
                  }}
                >
                  {task.status === "done" ? "\u2713" : task.status === "active" ? "\u25b8" : task.status === "blocked" ? "\u2717" : "\u00b7"}
                </span>
                <span
                  className={`${mono} text-[11px] leading-snug`}
                  style={{
                    color: task.status === "done"
                      ? "var(--p-text-muted, #6b7280)"
                      : "var(--p-text-secondary, #9aa3b0)",
                    textDecoration: task.status === "done" ? "line-through" : "none",
                    textDecorationColor: "var(--p-text-disabled, #4b5563)",
                  }}
                >
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Artifacts */}
        {item.artifacts.length > 0 && (
          <section>
            <h3
              className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`}
              style={{ color: "var(--p-text-disabled, #4b5563)" }}
            >
              artifacts
            </h3>
            <div className="space-y-1">
              {item.artifacts.map((art, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className={`${mono} text-[10px] shrink-0`}
                    style={{
                      color: art.action === "created"
                        ? "var(--p-success, #8ec07c)"
                        : art.action === "deleted"
                          ? "var(--p-danger, #d86c6c)"
                          : "var(--p-accent, #d5a868)",
                    }}
                  >
                    {art.action === "created" ? "+" : art.action === "deleted" ? "-" : "~"}
                  </span>
                  <span
                    className={`${mono} text-[10px] truncate`}
                    style={{ color: "var(--p-text-secondary, #9aa3b0)" }}
                  >
                    {art.path}
                  </span>
                  {art.lines && (
                    <span
                      className={`${mono} text-[9px] shrink-0`}
                      style={{ color: "var(--p-text-disabled, #4b5563)" }}
                    >
                      {art.lines}L
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Cost */}
        <section>
          <h3
            className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`}
            style={{ color: "var(--p-text-disabled, #4b5563)" }}
          >
            cost
          </h3>
          <div className="flex items-baseline gap-2">
            <span
              className={`${mono} text-[18px] font-bold tabular-nums`}
              style={{ color: "var(--p-text-default, #c5cdd8)" }}
            >
              {formatCost(item.cost)}
            </span>
            <span
              className={`${mono} text-[10px]`}
              style={{ color: "var(--p-text-muted, #6b7280)" }}
            >
              {item.turns} turns / {item.elapsed}
            </span>
          </div>
        </section>

        {/* Observations */}
        {item.observations && item.observations.length > 0 && (
          <section>
            <h3
              className={`${mono} text-[9px] uppercase tracking-widest font-bold mb-1.5`}
              style={{ color: "var(--p-text-disabled, #4b5563)" }}
            >
              observations
            </h3>
            <div className="space-y-1.5">
              {item.observations.map((obs, i) => (
                <p
                  key={i}
                  className={`${mono} text-[10px] leading-relaxed`}
                  style={{ color: "var(--p-text-muted, #6b7280)" }}
                >
                  {obs}
                </p>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  INTERVENTION BAR (bottom)                                          */
/* ================================================================== */

function InterventionBar({ items }: { items: WorkItem[] }) {
  const needsYou = items.filter(i => i.intervention)
  if (needsYou.length === 0) return null

  const item = needsYou[0]
  const intervention = item.intervention!

  return (
    <div
      className="flex items-center gap-3 border-t px-4"
      style={{
        height: 42,
        borderColor: "var(--p-accent, #d5a868)",
        backgroundColor: "color-mix(in srgb, var(--p-accent, #d5a868) 5%, var(--p-surface, #141720))",
      }}
    >
      <span
        className={`${mono} text-[10px] font-bold uppercase tracking-wider`}
        style={{ color: "var(--p-accent, #d5a868)" }}
      >
        {item.id}
      </span>
      <span
        className={`${mono} text-[11px] font-semibold`}
        style={{ color: agentColor(item.agent) }}
      >
        @{item.agent}
      </span>
      <span
        className={`${mono} text-[11px]`}
        style={{ color: "var(--p-text-secondary, #9aa3b0)" }}
      >
        {intervention.type}:
      </span>
      <span
        className={`${mono} text-[11px] flex-1 truncate`}
        style={{ color: "var(--p-text-default, #c5cdd8)" }}
      >
        {intervention.summary}
      </span>
      {intervention.options?.map(opt => (
        <button
          key={opt}
          type="button"
          className={`${mono} rounded border px-3 py-1 text-[10px] font-semibold transition-colors hover:brightness-110`}
          style={{
            borderColor: opt === "Allow" || opt === "Approve"
              ? "var(--p-success, #8ec07c)"
              : "var(--p-border-default, #2a2e37)",
            color: opt === "Allow" || opt === "Approve"
              ? "var(--p-success, #8ec07c)"
              : "var(--p-text-muted, #6b7280)",
            backgroundColor: "transparent",
          }}
        >
          {opt}
        </button>
      ))}
      {needsYou.length > 1 && (
        <span
          className={`${mono} text-[9px]`}
          style={{ color: "var(--p-text-disabled, #4b5563)" }}
        >
          +{needsYou.length - 1} more
        </span>
      )}
    </div>
  )
}

/* ================================================================== */
/*  MAIN CONSOLE                                                       */
/* ================================================================== */

export function OperatorConsole() {
  const [selectedId, setSelectedId] = useState(MOCK_WORK_ITEMS[0].id)
  const selected = MOCK_WORK_ITEMS.find(i => i.id === selectedId) ?? MOCK_WORK_ITEMS[0]

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--p-surface, #141720)" }}
    >
      <CommandBar />
      <div className="flex flex-1 min-h-0">
        <WorkStream
          items={MOCK_WORK_ITEMS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <ExecutionSurface item={selected} />
        <ContextPanel item={selected} />
      </div>
      <InterventionBar items={MOCK_WORK_ITEMS} />
    </div>
  )
}
