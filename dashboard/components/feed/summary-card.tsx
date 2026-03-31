"use client"

import { cn, formatCost } from "@/lib/utils"
import { AgentTag } from "@/components/agent/avatar"
import { CopyButton } from "@/components/shared/copy-button"
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
 * Agent summary card -- the primary content type in the project activity feed.
 * SOURCE: TimelineEntry.summary field (populated when agent completes a turn)
 * Shows: colored @agent tag, summary text, cost/turns/duration badge
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
    <div className="group/msg relative min-w-0">
      <div className="flex items-center gap-2 mb-0.5">
        <AgentTag name={agent} onClick={onClickAgent} />
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
      {summary.length > 0 && (
        <div className="absolute top-0 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          <CopyButton text={summary} />
        </div>
      )}
    </div>
  )
}
