import { cn } from "@/lib/utils"
import { AgentTag } from "@/components/agent/avatar"
import type { ReactNode } from "react"

interface CompactStatusLineProps {
  agent: string
  color?: string
  children: ReactNode
}

export function CompactStatusLine({ agent, color = "text-muted", children }: CompactStatusLineProps) {
  return (
    <div className="flex items-center gap-2 py-0.5 justify-center">
      <AgentTag name={agent} />
      <span className={cn("text-[10px] font-mono", color)}>
        {children}
      </span>
    </div>
  )
}
