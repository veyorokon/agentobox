"use client"

import { cn, formatDuration, formatCost } from "@/lib/utils"
import { Clock, Zap, RotateCw, AlertTriangle, DollarSign } from "lucide-react"
import type { SessionResult } from "@/types"

type ResultCardProps = {
  result: SessionResult
  className?: string
}

type ModelUsageEntry = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
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
    <div className="mt-2 pt-2 border-t border-border-300/10 space-y-1">
      {entries.map(([model, data]) => {
        if (!data || typeof data !== "object") return null
        const input = data.input_tokens ?? 0
        const output = data.output_tokens ?? 0
        const cacheWrite = data.cache_creation_input_tokens ?? 0
        const cacheRead = data.cache_read_input_tokens ?? 0

        // Short model name — strip everything before the last slash
        const shortName = model.includes("/")
          ? model.split("/").pop()
          : model

        return (
          <div key={model} className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-text-300 truncate min-w-0 max-w-[140px]">
              {shortName}
            </span>
            <span className="text-text-400">
              {formatTokenCount(input)} in
            </span>
            <span className="text-text-400">/</span>
            <span className="text-text-400">
              {formatTokenCount(output)} out
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

export function ResultCard({ result, className }: ResultCardProps) {
  const cost = parseFloat(result.totalCostUsd) || 0
  const hasModelUsage =
    result.modelUsage && Object.keys(result.modelUsage).length > 0

  return (
    <div
      className={cn(
        "rounded-md bg-bg-200 px-3 py-2.5 border-l-2",
        result.isError
          ? "border-l-danger-000"
          : "border-l-accent-main-000",
        className,
      )}
    >
      {/* Top row: status label + cost */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className={cn(
            "text-xs font-semibold",
            result.isError ? "text-danger-000" : "text-accent-main-000",
          )}
        >
          {result.isError ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle size={12} />
              Session Errored
            </span>
          ) : (
            "Session Complete"
          )}
        </span>
        <span className="text-xs text-text-400 font-mono">
          {formatCost(cost)}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-[11px] text-text-300 font-mono">
        <span className="inline-flex items-center gap-1">
          <Clock size={11} className="text-text-400" />
          {formatDuration(result.durationMs)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Zap size={11} className="text-text-400" />
          {formatDuration(result.durationApiMs)} API
        </span>
        <span className="inline-flex items-center gap-1">
          <RotateCw size={11} className="text-text-400" />
          {result.numTurns} turn{result.numTurns !== 1 ? "s" : ""}
        </span>
        {cost > 0 && (
          <span className="inline-flex items-center gap-1">
            <DollarSign size={11} className="text-text-400" />
            {formatCost(cost)}
          </span>
        )}
      </div>

      {/* Model usage breakdown (optional) */}
      {hasModelUsage && (
        <ModelUsageBreakdown usage={result.modelUsage} />
      )}
    </div>
  )
}
