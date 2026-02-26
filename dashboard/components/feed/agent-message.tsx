"use client"

import { AgentAvatar } from "@/components/agent/avatar"

export interface AgentToAgentMessageProps {
  from: string
  to: string
  text: string
  onClickAgent?: (name: string) => void
}

/**
 * Agent-to-agent message -- inline with arrow between two agent avatars.
 * SOURCE: inter-agent @mention communication
 */
export function AgentToAgentMessage({ from, to, text, onClickAgent }: AgentToAgentMessageProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-0.5">
      <button type="button" onClick={() => onClickAgent?.(from)} className="shrink-0 cursor-pointer">
        <AgentAvatar name={from} size="sm" />
      </button>
      <span className="text-[10px] text-muted/30">→</span>
      <button type="button" onClick={() => onClickAgent?.(to)} className="shrink-0 cursor-pointer">
        <AgentAvatar name={to} size="sm" />
      </button>
      <span className="text-[10px] text-secondary font-mono truncate max-w-md">{text}</span>
    </div>
  )
}
