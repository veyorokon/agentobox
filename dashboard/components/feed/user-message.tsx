import { cn } from "@/lib/utils"
import type { FeedItem } from "@/types"

type UserMessageProps = {
  item: FeedItem
}

export function UserMessage({ item }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%]">
        {item.targetName && (
          <div className="text-xs text-text-400 text-right mb-1">
            → {item.targetName}
          </div>
        )}
        <div className="bg-bg-000 rounded-[0.4rem] px-3 py-2">
          <p className="text-text-100 text-sm whitespace-pre-wrap">
            {item.text}
          </p>
        </div>
      </div>
    </div>
  )
}
