"use client"

import { CheckSquare } from "lucide-react"
import type { FakeAgent } from "@/lib/types"

export interface LiveStatusBarProps {
  agent: FakeAgent
}

/** Pinned between feed and composer in agent detail view */
export function LiveStatusBar({ agent }: LiveStatusBarProps) {
  return (
    <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-sunken/20 flex items-center gap-2 min-h-[28px]">
      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-breathe shrink-0" />
      <span className="text-[11px] font-mono text-secondary truncate">
        {agent.liveAction || "Working..."}
      </span>
      {agent.todoProgress && (
        <span className="ml-auto flex items-center gap-1 shrink-0">
          <CheckSquare className="h-3 w-3 text-muted/60" />
          <span className="text-[10px] font-mono text-muted">
            {agent.todoProgress.done}/{agent.todoProgress.total}
          </span>
        </span>
      )}
    </div>
  )
}
