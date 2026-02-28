import { ChatAvatar } from "@/components/agent/avatar"
import type { ReactNode } from "react"

interface MessageCardProps {
  agent: string
  children: ReactNode
  className?: string
}

export function MessageCard({ agent, children, className }: MessageCardProps) {
  return (
    <div className="flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
        <div className={`rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-lg ${className ?? ""}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
