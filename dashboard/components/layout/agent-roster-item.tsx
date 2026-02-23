"use client"

import { cn, formatCost, formatTime, agentHue } from "@/lib/utils"
import type { Agent } from "@/types"

type AgentRosterItemProps = {
  agent: Agent
  isSelected: boolean
  onClick: () => void
}

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
  string,
  { dot: string; label: string; glow?: string }
> = {
  running: {
    dot: "bg-success",
    label: "Running",
    glow: "text-success",
  },
  idle: {
    dot: "bg-info",
    label: "Idle",
  },
  waiting: {
    dot: "bg-warning",
    label: "Waiting",
    glow: "text-warning",
  },
  error: {
    dot: "bg-danger",
    label: "Error",
    glow: "text-danger",
  },
  stopped: {
    dot: "bg-muted/50",
    label: "Stopped",
  },
  deploying: {
    dot: "bg-accent",
    label: "Starting",
    glow: "text-accent",
  },
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { dot: "bg-muted/50", label: status }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function AgentRosterItem({ agent, isSelected, onClick }: AgentRosterItemProps) {
  const config = getStatusConfig(agent.status)
  const cost = parseFloat(agent.sessionCostUsd) || 0
  const isRunning = agent.status === "running"
  const isError = agent.status === "error"
  const isStopped = agent.status === "stopped"
  const isDeploying = agent.status === "deploying"
  const hue = agentHue(agent.name)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group mx-1.5 rounded-lg transition-all duration-(--duration-normal) text-left",
        "border-l-2 border-transparent",
        // Selected state
        isSelected && "bg-surface-raised/80 border-l-accent",
        // Hover state (not selected)
        !isSelected && "hover:bg-surface-raised/30",
        // Error agents get subtle red tint
        isError && !isSelected && "hover:bg-danger-subtle",
        isError && isSelected && "bg-danger-subtle/60 border-l-danger",
        // Stopped agents are dimmed
        isStopped && "opacity-55",
        // Running agents get the border pulse when not selected
        isRunning && !isSelected && "animate-border-pulse",
      )}
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        {/* Avatar */}
        <div
          className={cn(
            "h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 transition-opacity",
          )}
          style={{
            backgroundColor: `hsl(${hue} ${isStopped ? "25%" : "40%"} ${isStopped ? "18%" : "22%"})`,
            color: `hsl(${hue} ${isStopped ? "30%" : "55%"} ${isStopped ? "45%" : "68%"})`,
          }}
        >
          {agent.name.charAt(0).toUpperCase()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: status dot + name + meta */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                config.dot,
                isRunning && "animate-breathe",
                isRunning && config.glow,
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

            {/* Right meta: status label for error/deploying, time otherwise */}
            {isError ? (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-danger shrink-0">
                err
              </span>
            ) : isDeploying ? (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-accent shrink-0">
                init
              </span>
            ) : (
              <span className="text-[10px] text-muted/60 shrink-0 tabular-nums font-mono">
                {formatTime(agent.createdAt)}
              </span>
            )}
          </div>

          {/* Row 2: activity text + cost */}
          <div className="flex items-center gap-1 mt-px">
            <span
              className={cn(
                "text-[11px] truncate flex-1 leading-tight",
                isError ? "text-danger/80" : "text-muted/70",
              )}
            >
              {getActivityText(agent)}
            </span>

            {cost > 0 && (
              <span className="text-[9px] text-muted/50 font-mono shrink-0 tabular-nums">
                {formatCost(cost)}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Activity text                                                      */
/* ------------------------------------------------------------------ */

function getActivityText(agent: Agent): string {
  if (agent.status === "error") {
    const result = agent.sessionResult
    if (result?.isError) return "Session errored"
    return "Error"
  }

  if (agent.status === "stopped") {
    const result = agent.sessionResult
    if (result) {
      const turns = result.numTurns
      return `Completed${turns ? ` (${turns} turn${turns === 1 ? "" : "s"})` : ""}`
    }
    return "Stopped"
  }

  if (agent.status === "running") {
    if (agent.phase) {
      return agent.phase.charAt(0).toUpperCase() + agent.phase.slice(1)
    }
    return "Working..."
  }

  if (agent.status === "idle") return "Idle"
  if (agent.status === "waiting") return "Waiting for input"
  if (agent.status === "deploying") return "Starting up..."

  return agent.status
}

export { AgentRosterItem }
export type { AgentRosterItemProps }
