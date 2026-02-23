"use client"

import { formatCost, friendlyModelName } from "@/lib/utils"
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
    items.push(friendlyModelName(agent.model))
  }

  const toolCount = Array.isArray((agent.capabilities as Record<string, unknown>)?.tools)
    ? ((agent.capabilities as Record<string, unknown>).tools as unknown[]).length
    : 0
  if (toolCount > 0) {
    items.push(`${toolCount} tools`)
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
    <div className="h-8 border-b border-border-default bg-surface px-4 flex items-center gap-2">
      {items.map((item, i) => (
        <span key={i} className="text-xs text-muted flex items-center gap-2">
          {i > 0 && <span className="text-muted">&middot;</span>}
          <span className="font-mono">{item}</span>
        </span>
      ))}
    </div>
  )
}

export { SessionInfoBar }
export type { SessionInfoBarProps }
