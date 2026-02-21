"use client"

import { formatModelName } from "@/lib/format"
import { formatCost } from "@/lib/utils"
import type { Agent } from "@/types"

type SessionInfoBarProps = {
  agent: Agent | null
}

function SessionInfoBar({ agent }: SessionInfoBarProps) {
  if (!agent) return null

  const cost = parseFloat(agent.sessionCostUsd) || 0
  const numTurns = agent.sessionResult?.numTurns ?? null

  const items: string[] = []

  if (agent.model) {
    items.push(formatModelName(agent.model))
  }

  if (cost > 0) {
    items.push(formatCost(cost))
  }

  if (numTurns !== null) {
    items.push(`${numTurns} turn${numTurns === 1 ? "" : "s"}`)
  }

  if (agent.permissionMode) {
    items.push(agent.permissionMode)
  }

  if (agent.phase) {
    items.push(agent.phase)
  }

  if (items.length === 0) return null

  return (
    <div className="h-8 border-b border-border-300 bg-bg-100 px-4 flex items-center gap-2">
      {items.map((item, i) => (
        <span key={i} className="text-xs text-text-400 flex items-center gap-2">
          {i > 0 && <span className="text-text-500">&middot;</span>}
          <span className="font-mono">{item}</span>
        </span>
      ))}
    </div>
  )
}

export { SessionInfoBar }
export type { SessionInfoBarProps }
