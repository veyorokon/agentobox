"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { LIFECYCLE_CONFIG } from "@/lib/config"
import type { LifecycleStatus, TeamFeedItem } from "@/lib/types"
import { AgentTag } from "@/components/agent/avatar"

type StatusFeedItem = Extract<TeamFeedItem, { type: "status" }>

interface StatusBarProps {
  items: StatusFeedItem[]
  onClickAgent?: (name: string) => void
}

/**
 * Horizontal status timeline bar -- sits at the top of the feed area.
 * Shows the most recent status transition per agent as compact pills.
 * Renders nothing when there are no status items (no layout space taken).
 */
export function StatusBar({ items, onClickAgent }: StatusBarProps) {
  // Deduplicate: keep only the most recent transition per agent.
  // Feed items are ordered chronologically, so last occurrence wins.
  const latestPerAgent = useMemo(() => {
    const map = new Map<string, StatusFeedItem>()
    for (const item of items) {
      map.set(item.agent, item)
    }
    return Array.from(map.values())
  }, [items])

  if (latestPerAgent.length === 0) return null

  return (
    <div className="w-full px-3 @[640px]/main:px-6 py-1.5 shrink-0">
      <div className="max-w-3xl mx-auto flex items-center justify-center gap-x-4 gap-y-1 flex-wrap">
        {latestPerAgent.map((item) => {
          const toConfig = LIFECYCLE_CONFIG[item.to as LifecycleStatus] ?? LIFECYCLE_CONFIG.stopped

          return (
            <div key={item.agent} className="flex items-baseline gap-1.5">
              <AgentTag name={item.agent} onClick={onClickAgent} className="text-[10px]" />
              <span className="text-[10px] text-muted/40 font-mono">{item.from}</span>
              <span className="text-[10px] text-muted/30 select-none">{"\u2192"}</span>
              <span className={cn("inline-flex items-baseline gap-1 text-[10px] font-mono font-medium", toConfig.text)}>
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 self-center", toConfig.dot)} />
                {item.to}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
