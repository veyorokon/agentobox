"use client"

import { useState } from "react"
import { Check, X, ChevronRight } from "lucide-react"
import { cn, formatCost } from "@/lib/utils"
import { Collapsible } from "@/components/ui/collapsible"

/** Per-model token usage from the SDK's modelUsage dict */
type ModelUsageEntry = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

/** modelUsage is keyed by model ID, e.g. {"claude-sonnet-4-6": {...}} */
export type ModelUsage = Record<string, ModelUsageEntry>

export interface ResultPillProps {
  isError?: boolean
  cost: number
  duration: string
  turns: number
  model: string
  modelUsage?: ModelUsage
}

/** Format a token count: 12400 → "12.4k", 350 → "350" */
function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, "")}k`
  }
  return String(n)
}

/** Aggregate token counts across all models in modelUsage */
function aggregateTokens(usage: ModelUsage): {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  hasData: boolean
} {
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0

  for (const entry of Object.values(usage)) {
    input += entry.inputTokens ?? 0
    output += entry.outputTokens ?? 0
    cacheRead += entry.cacheReadInputTokens ?? 0
    cacheWrite += entry.cacheCreationInputTokens ?? 0
  }

  const hasData = input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0
  return { input, output, cacheRead, cacheWrite, hasData }
}

/** Compact inline status pill with expandable details */
export function ResultPill({
  isError = false,
  cost,
  duration,
  turns,
  model,
  modelUsage,
}: ResultPillProps) {
  const [expanded, setExpanded] = useState(false)

  const tokens = modelUsage ? aggregateTokens(modelUsage) : null
  const totalCache = tokens ? tokens.cacheRead + tokens.cacheWrite : 0

  return (
    <div className="ml-8">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-mono cursor-pointer hover:bg-surface-sunken/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
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
            {tokens?.hasData && (
              <>
                <span className="text-muted">
                  {formatTokens(tokens.input)} in / {formatTokens(tokens.output)} out
                </span>
                {totalCache > 0 && (
                  <span className="text-muted">
                    (cache: {formatTokens(tokens.cacheRead)}r / {formatTokens(tokens.cacheWrite)}w)
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </Collapsible>
    </div>
  )
}
