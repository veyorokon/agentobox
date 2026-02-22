import { memo } from "react"
import type {
  TimelineEntry,
  ContentBlock,
  ToolUseBlock,
  AssistantEventData,
  UserEventData,
  SystemEventData,
  ResultEventData,
  StatusEventData,
} from "@/types"
import { UserMessage } from "@/components/feed/user-message"
import { AssistantMessage } from "@/components/feed/assistant-message"
import { ToolGroup } from "@/components/feed/tool-group"
import { StatusMessage } from "@/components/feed/status-message"
import { SystemMessage } from "@/components/feed/system-message"
import { ResultCard } from "@/components/feed/result-card"

type FeedItemRouterProps = {
  item: TimelineEntry
  showAvatar?: boolean
}

/**
 * Extract content blocks from an assistant message's data.
 * data.message.content is the array of content blocks from Claude Code.
 */
function getContentBlocks(data: AssistantEventData): ContentBlock[] {
  const content = data.message.content
  if (Array.isArray(content)) return content
  return []
}

/**
 * Extract tool_use blocks from content blocks.
 */
function getToolUseBlocks(blocks: ContentBlock[]): ToolUseBlock[] {
  return blocks.filter((b): b is ToolUseBlock => b.type === "tool_use")
}

/**
 * Check if content blocks have any visible text content (text blocks with non-empty text).
 */
function hasTextContent(blocks: ContentBlock[]): boolean {
  return blocks.some(
    (b) => b.type === "text" && "text" in b && b.text.trim().length > 0,
  )
}

function renderItem(item: TimelineEntry, showAvatar: boolean) {
  switch (item.entryType) {
    case "assistant": {
      const data = item.data as AssistantEventData
      const blocks = getContentBlocks(data)
      const toolBlocks = getToolUseBlocks(blocks)
      const showText = hasTextContent(blocks)

      return (
        <>
          {showText && (
            <AssistantMessage data={data} agentName={item.agentName} showAvatar={showAvatar} />
          )}
          {toolBlocks.length > 0 && (
            <ToolGroup toolBlocks={toolBlocks} />
          )}
        </>
      )
    }

    case "user":
      return <UserMessage data={item.data as UserEventData} />

    case "system": {
      const data = item.data as SystemEventData
      if (data.subtype === "relay_init") return null
      return <SystemMessage data={data} />
    }

    case "result":
      return <ResultCard data={item.data as ResultEventData} />

    case "status":
      return <StatusMessage data={item.data as StatusEventData} agentName={item.agentName} />

    case "stream_event":
      // Skip streaming deltas — used for phase indicator only
      return null

    default:
      return null
  }
}

export const FeedItemRouter = memo(
  function FeedItemRouter({ item, showAvatar = true }: FeedItemRouterProps) {
    const content = renderItem(item, showAvatar)
    if (!content) return null

    return <div className="max-w-3xl mx-auto w-full px-6 py-1">{content}</div>
  },
  (prev, next) => prev.item.id === next.item.id && prev.showAvatar === next.showAvatar,
)
