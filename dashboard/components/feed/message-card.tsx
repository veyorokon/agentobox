import { AgentTag } from "@/components/agent/avatar"
import type { ReactNode } from "react"

interface MessageCardProps {
  agent: string
  children: ReactNode
  className?: string
}

export function MessageCard({ agent, children, className }: MessageCardProps) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-mono mb-0.5">
        <AgentTag name={agent} />
      </div>
      <div className={`rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-lg ${className ?? ""}`}>
        {children}
      </div>
    </div>
  )
}
