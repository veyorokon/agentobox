"use client"

import type { ToolUseItem } from "@/types"

type ToolUseSummaryProps = {
  tools: ToolUseItem[]
}

type ToolCount = {
  name: string
  count: number
  errorCount: number
}

function aggregateTools(tools: ToolUseItem[]): ToolCount[] {
  const map = new Map<string, { count: number; errorCount: number }>()

  for (const tool of tools) {
    const existing = map.get(tool.name)
    if (existing) {
      existing.count++
      if (tool.isError) existing.errorCount++
    } else {
      map.set(tool.name, { count: 1, errorCount: tool.isError ? 1 : 0 })
    }
  }

  return Array.from(map.entries()).map(([name, { count, errorCount }]) => ({
    name,
    count,
    errorCount,
  }))
}

export function ToolUseSummary({ tools }: ToolUseSummaryProps) {
  if (tools.length === 0) return null

  const grouped = aggregateTools(tools)

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-text-400 font-mono">
      {grouped.map((entry, i) => (
        <span key={entry.name} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="text-text-500 mx-0.5">&middot;</span>}
          <span className={entry.errorCount > 0 ? "text-danger-000" : "text-text-300"}>
            {entry.name}
          </span>
          <span className="text-text-500">({entry.count})</span>
        </span>
      ))}
    </div>
  )
}
