import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type { FeedItem } from "@/types"

type AssistantMessageProps = {
  item: FeedItem
  isTeam?: boolean
}

export function AssistantMessage({ item, isTeam }: AssistantMessageProps) {
  return (
    <div className="group/message flex items-start gap-2 max-w-[85%]">
      <Avatar name={item.agentName} size="sm" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-text-300 mb-1">
          <span>{item.agentName}</span>
          {isTeam && <Badge variant="info">team</Badge>}
        </div>

        {item.text && (
          <MarkdownRenderer content={item.text} className="text-sm text-text-100" />
        )}

        {item.imageUrls && item.imageUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {item.imageUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                className="rounded-lg max-w-[300px] max-h-[200px] object-cover"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
