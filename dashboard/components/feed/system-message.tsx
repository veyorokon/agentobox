import type { FeedItem } from "@/types"
import { ThinkingIndicator } from "@/components/feed/thinking-indicator"

const ACTIVE_KEYWORDS = ["restarting", "starting", "switching", "running"]

function isActiveSystem(text: string): boolean {
  const lower = text.toLowerCase()
  return ACTIVE_KEYWORDS.some((kw) => lower.includes(kw))
}

type SystemMessageProps = {
  item: FeedItem
}

export function SystemMessage({ item }: SystemMessageProps) {
  const text = item.text || ""

  if (isActiveSystem(text)) {
    return (
      <div className="flex items-center justify-center py-1">
        <ThinkingIndicator label={text} />
      </div>
    )
  }

  return (
    <div className="text-center text-text-500 text-xs font-mono py-1">
      {text}
    </div>
  )
}
