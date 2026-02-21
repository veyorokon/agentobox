import type { FeedItem } from "@/types"
import { UserMessage } from "@/components/feed/user-message"
import { AssistantMessage } from "@/components/feed/assistant-message"
import { ToolGroup } from "@/components/feed/tool-group"
import { ErrorMessage } from "@/components/feed/error-message"
import { QuestionCard } from "@/components/feed/question-card"
import { PlanMessage } from "@/components/feed/plan-message"
import { StatusMessage } from "@/components/feed/status-message"
import { SystemMessage } from "@/components/feed/system-message"
import { TaskDivider } from "@/components/feed/task-divider"

type FeedItemRouterProps = {
  item: FeedItem
}

function renderItem(item: FeedItem) {
  switch (item.kind) {
    case "USER_MESSAGE":
      return <UserMessage item={item} />
    case "AGENT_TEXT":
      return <AssistantMessage item={item} />
    case "ACTIVITY":
      return <ToolGroup item={item} />
    case "ERROR":
      return <ErrorMessage item={item} />
    case "QUESTION":
      return <QuestionCard item={item} />
    case "PLAN":
      return <PlanMessage item={item} />
    case "STATUS":
      return <StatusMessage item={item} />
    case "SYSTEM":
      return <SystemMessage item={item} />
    case "TASK_START":
    case "TASK_END":
      return <TaskDivider item={item} />
    case "TEAM_MESSAGE":
      return <AssistantMessage item={item} isTeam />
    default:
      return null
  }
}

export function FeedItemRouter({ item }: FeedItemRouterProps) {
  const content = renderItem(item)
  if (!content) return null

  return <div className="px-4 py-1">{content}</div>
}
