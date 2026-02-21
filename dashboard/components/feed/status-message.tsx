import type { FeedItem } from "@/types"
import { ThinkingIndicator } from "@/components/feed/thinking-indicator"

const ACTIVE_STATUSES = new Set([
  "running",
  "restarting",
  "switching",
  "starting",
])

function isActiveTransition(item: FeedItem): boolean {
  const text = (item.text || "").toLowerCase()
  const toStatus = (item.toStatus || "").toLowerCase()
  return (
    ACTIVE_STATUSES.has(toStatus) ||
    [...ACTIVE_STATUSES].some((s) => text.includes(s))
  )
}

type StatusMessageProps = {
  item: FeedItem
}

export function StatusMessage({ item }: StatusMessageProps) {
  const label = item.text || (item.fromStatus && item.toStatus ? `${item.fromStatus} → ${item.toStatus}` : "Status changed")

  if (isActiveTransition(item)) {
    return (
      <div className="flex items-center justify-center py-1 gap-2">
        <ThinkingIndicator
          label={`${item.agentName} ${label}`}
        />
      </div>
    )
  }

  return (
    <div className="text-center text-text-400 text-xs font-mono py-1">
      {item.agentName} {label}
    </div>
  )
}
