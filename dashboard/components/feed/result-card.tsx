"use client"

import { useState, useContext } from "react"
import { cn, formatDuration, formatCost, friendlyModelName } from "@/lib/utils"
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
    <div className="mt-1.5 space-y-0.5">
      {entries.map(([model, modelData]) => {
        if (!modelData || typeof modelData !== "object") return null
        const input = modelData.inputTokens ?? 0
        const output = modelData.outputTokens ?? 0
        const cacheWrite = modelData.cacheCreationInputTokens ?? 0
        const cacheRead = modelData.cacheReadInputTokens ?? 0

        return (
          <div key={model} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-text-300 truncate min-w-0 max-w-[140px]">
              {friendlyModelName(model)}
            </span>
            <span className="text-text-500">
              {formatTokenCount(input)} in / {formatTokenCount(output)} out
            </span>
            {(cacheWrite > 0 || cacheRead > 0) && (
              <span className="text-text-500">
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
  const { scrollToBottom } = useContext(FeedScrollContext)

  const cost = data.total_cost_usd ?? 0
  const durationMs = data.duration_ms ?? 0
  const numTurns = data.num_turns ?? 0
  const modelUsage = data.modelUsage ?? {}
  const isError = !!data.is_error
  const errorResult = data.result
  const hasModelUsage = Object.keys(modelUsage).length > 0

  // Build stats string: "12s · 3 turns"
  const statParts: string[] = []
  if (durationMs > 0) statParts.push(formatDuration(durationMs))
  if (numTurns > 0) statParts.push(`${numTurns} turn${numTurns !== 1 ? "s" : ""}`)
  const statsText = statParts.join(" \u00b7 ")

  return (
    <div className={cn("ml-8", className)}>
      {/* Pill row */}
      <div
        className="inline-flex items-center gap-1.5 cursor-pointer"
        onClick={() => {
          if (!hasModelUsage) return
          const willExpand = !expanded
          setExpanded(willExpand)
          if (willExpand) {
            // Give Virtuoso time to measure the new size, then scroll
            requestAnimationFrame(() => scrollToBottom())
          }
        }}
      >
        {/* Status pill */}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-medium",
            isError
              ? "bg-danger-900/20 text-danger-000"
              : "bg-success-900/20 text-success-000",
          )}
        >
          <span className="text-[9px]">{isError ? "\u2717" : "\u2713"}</span>
          {isError ? "errored" : "done"}
        </span>

        {/* Cost pill */}
        {cost > 0 && (
          <span className="inline-flex items-center rounded-full bg-bg-200/80 px-2 py-0.5 text-[10px] font-mono text-text-400">
            {formatCost(cost)}
          </span>
        )}

        {/* Stats pill */}
        {statsText && (
          <span className="inline-flex items-center rounded-full bg-bg-200/80 px-2 py-0.5 text-[10px] font-mono text-text-400">
            {statsText}
          </span>
        )}

        {/* Expand indicator */}
        {hasModelUsage && (
          <span className={cn(
            "text-text-500 text-[10px] transition-transform duration-150",
            expanded && "rotate-90",
          )}>
            {"\u25b8"}
          </span>
        )}
      </div>

      {/* Error message */}
      {isError && errorResult && (
        <p className="mt-1 text-danger-000 text-xs font-mono whitespace-pre-wrap leading-relaxed">
          {errorResult}
        </p>
      )}

      {/* Expanded model usage */}
      {expanded && hasModelUsage && (
        <ModelUsageBreakdown usage={modelUsage} />
      )}
    </div>
  )
}
