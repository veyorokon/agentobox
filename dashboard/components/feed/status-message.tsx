import { ThinkingIndicator } from "@/components/feed/thinking-indicator"
import type { StatusEventData } from "@/types"

const ACTIVE_STATUSES = new Set([
  "running",
  "restarting",
  "switching",
  "starting",
])

type StatusMessageProps = {
  data: StatusEventData
  agentName: string
}

export function StatusMessage({ data, agentName }: StatusMessageProps) {
  const from = data.from
  const to = data.to

  const label = from && to ? `${agentName} ${from} → ${to}` : `${agentName} status changed`
  const isActive = (to && ACTIVE_STATUSES.has(to.toLowerCase())) ?? false

  if (isActive) {
    return (
      <div className="flex items-center justify-center py-px">
        <ThinkingIndicator label={label} />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center py-px">
      <span className="text-muted/60 text-[10px] font-mono">
        {label}
      </span>
    </div>
  )
}
