"use client"

import { cn, formatCost } from "@/lib/utils"
import { ChatAvatar } from "@/components/agent/avatar"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"

export interface AgentSummaryCardProps {
  agent: string
  summary: string
  cost: number
  turns: number
  duration: string
  isError?: boolean
  onClickAgent?: (name: string) => void
}

/**
 * Agent summary card -- the primary content type in the team feed.
 * SOURCE: TimelineEntry.summary field (populated when agent completes a turn)
 * Shows: agent avatar, summary text, cost/turns/duration badge
 */
export function AgentSummaryCard({
  agent,
  summary,
  cost,
  turns,
  duration,
  isError = false,
  onClickAgent,
}: AgentSummaryCardProps) {
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
          <MarkdownRenderer
            content={summary}
            className={cn(
              "text-sm leading-relaxed",
              isError ? "text-danger" : "text-default",
            )}
          />
        </div>
      </div>
    </div>
  )
}
