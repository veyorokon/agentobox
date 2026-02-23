"use client"

import { useState, useContext } from "react"
import { cn, formatDuration, formatCost, friendlyModelName } from "@/lib/utils"
import { Check, X, ChevronRight } from "lucide-react"
import { Collapsible } from "@/components/ui/collapsible"
import { FeedScrollContext } from "@/components/feed/feed-container"
import type { ResultEventData } from "@/types"

type ResultCardProps = {
  data: ResultEventData
  className?: string
}

type ModelUsageEntry = {
  inputTokens?: number
  outputTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  costUSD?: number
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function ModelUsageBreakdown({ usage }: { usage: Record<string, unknown> }) {
  const entries = Object.entries(usage) as [string, ModelUsageEntry][]
  if (entries.length === 0) return null

  return (
    <div className="mt-1 ml-0.5 space-y-0.5">
      {entries.map(([model, modelData]) => {
        if (!modelData || typeof modelData !== "object") return null
        const input = modelData.inputTokens ?? 0
        const output = modelData.outputTokens ?? 0
        const cacheWrite = modelData.cacheCreationInputTokens ?? 0
        const cacheRead = modelData.cacheReadInputTokens ?? 0

        return (
          <div key={model} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-secondary truncate min-w-0 max-w-[140px]">
              {friendlyModelName(model)}
            </span>
            <span className="text-muted">
              {formatTokenCount(input)} in / {formatTokenCount(output)} out
            </span>
            {(cacheWrite > 0 || cacheRead > 0) && (
              <span className="text-muted">
                (cache: {formatTokenCount(cacheRead)}r
                {cacheWrite > 0 && ` ${formatTokenCount(cacheWrite)}w`})
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ResultCard({ data, className }: ResultCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { isAtBottom, scrollAfterExpand } = useContext(FeedScrollContext)

  const cost = data.total_cost_usd ?? 0
  const durationMs = data.duration_ms ?? 0
  const numTurns = data.num_turns ?? 0
  const modelUsage = data.modelUsage ?? {}
  const isError = !!data.is_error
  const errorResult = data.result
  const hasModelUsage = Object.keys(modelUsage).length > 0
  const canExpand = hasModelUsage || numTurns > 0

  return (
    <div className={cn("ml-8", className)}>
      {/* Compact pill row */}
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-mono transition-colors",
          canExpand && "cursor-pointer hover:bg-surface-sunken/40",
          !canExpand && "cursor-default",
        )}
        onClick={() => {
          if (!canExpand) return
          const wasAtBottom = isAtBottom()
          const willExpand = !expanded
          setExpanded(willExpand)
          if (willExpand && wasAtBottom) scrollAfterExpand()
        }}
      >
        {/* Status icon */}
        {isError ? (
          <X size={12} className="shrink-0 text-danger" strokeWidth={2.5} />
        ) : (
          <Check size={12} className="shrink-0 text-success" strokeWidth={2.5} />
        )}

        {/* Cost */}
        {cost > 0 && (
          <span className="text-secondary">{formatCost(cost)}</span>
        )}

        {/* Duration */}
        {durationMs > 0 && (
          <>
            <span className="text-muted/50">&middot;</span>
            <span className="text-muted">{formatDuration(durationMs)}</span>
          </>
        )}

        {/* Expand chevron */}
        {canExpand && (
          <ChevronRight
            size={10}
            className={cn(
              "shrink-0 text-muted/60 transition-transform duration-150 ml-0.5",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>

      {/* Error message */}
      {isError && errorResult && (
        <p className="mt-1 ml-2 text-danger text-xs font-mono whitespace-pre-wrap leading-relaxed max-w-lg">
          {errorResult}
        </p>
      )}

      {/* Expanded details */}
      <Collapsible open={expanded}>
        <div className="ml-2 mt-0.5 space-y-0.5">
          {/* Turns */}
          {numTurns > 0 && (
            <div className="text-[10px] font-mono text-muted">
              {numTurns} turn{numTurns !== 1 ? "s" : ""}
            </div>
          )}

          {/* Model usage breakdown */}
          {hasModelUsage && <ModelUsageBreakdown usage={modelUsage} />}
        </div>
      </Collapsible>
    </div>
  )
}
