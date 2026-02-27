"use client"

import { cn } from "@/lib/utils"
import { AgentAvatar } from "@/components/agent/avatar"

export interface TaskFeedCardProps {
  agent: string
  text: string
  from: string
  to: string
  target?: string
}

const STATUS_STYLE: Record<string, { text: string; label: string }> = {
  pending:     { text: "text-muted",   label: "pending" },
  in_progress: { text: "text-info",    label: "in progress" },
  completed:   { text: "text-success", label: "done" },
}

function verb(from: string, to: string): string {
  if (!from && to === "pending") return "created"
  if (to === "in_progress") return "claimed"
  if (to === "completed") return "completed"
  return "updated"
}

export function TaskFeedCard({ agent, text, from, to, target }: TaskFeedCardProps) {
  const style = STATUS_STYLE[to] ?? STATUS_STYLE.pending
  const actor = target && to === "in_progress" ? target : agent

  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <div className="shrink-0">
        <AgentAvatar name={actor} size="sm" />
      </div>
      <span className="text-[10px] text-muted font-mono truncate max-w-md">
        {actor} {verb(from, to)} &ldquo;{text}&rdquo;
      </span>
      <span className={cn("text-[10px] font-mono font-medium", style.text)}>
        {to === "completed" ? "\u2713" : style.label}
      </span>
    </div>
  )
}
