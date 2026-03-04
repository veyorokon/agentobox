"use client"

import { cn } from "@/lib/utils"
import { LIFECYCLE_CONFIG } from "@/lib/config"
import type { LifecycleStatus } from "@/lib/types"
import { AgentTag } from "@/components/agent/avatar"

export interface AgentStatusLineProps {
  agent: string
  from: string
  to: string
  onClickAgent?: (name: string) => void
}

/**
 * Status transition line -- inline status change notification.
 * SOURCE: StreamEvent status change (agent.status field transitions)
 */
export function AgentStatusLine({ agent, from, to, onClickAgent }: AgentStatusLineProps) {
  const toConfig = LIFECYCLE_CONFIG[to as LifecycleStatus] ?? LIFECYCLE_CONFIG.stopped

  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <AgentTag name={agent} onClick={onClickAgent} />
      <span className="text-[10px] text-muted/40 font-mono">{from}</span>
      <span className="text-[10px] text-muted/30">→</span>
      <span className={cn("text-[10px] font-mono font-medium", toConfig.text)}>
        {to}
      </span>
    </div>
  )
}
