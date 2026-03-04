"use client"

import { AgentTag } from "@/components/agent/avatar"

export interface AgentToAgentMessageProps {
  from: string
  to: string
  text: string
  onClickAgent?: (name: string) => void
}

/**
 * Agent-to-agent message -- inline with arrow between two agent tags.
 * SOURCE: inter-agent @mention communication
 */
export function AgentToAgentMessage({ from, to, text, onClickAgent }: AgentToAgentMessageProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <AgentTag name={from} onClick={onClickAgent} />
      <span className="text-[10px] text-muted/30">→</span>
      <AgentTag name={to} onClick={onClickAgent} />
      <span className="text-[10px] text-secondary font-mono truncate max-w-md">{text}</span>
    </div>
  )
}
