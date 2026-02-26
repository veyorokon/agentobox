"use client"

import { useMemo } from "react"
import type { TeamFeedItem } from "@/lib/types"
import { getFeedItemAgent } from "@/lib/attention"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SystemMessage } from "@/components/feed/system-message"
import { TeamUserMessage } from "@/components/feed/user-message"
import { AgentSummaryCard } from "@/components/feed/summary-card"
import { AgentStatusLine } from "@/components/feed/status-line"
import { AgentToAgentMessage } from "@/components/feed/agent-message"
import { TeamErrorAlert } from "@/components/feed/error-alert"
import { QuestionCard, MultiQuestionCard } from "@/components/feed/question-card"
import { PlanCard } from "@/components/feed/plan-card"
import { PermissionCard } from "@/components/feed/permission-card"

export interface TeamFeedProps {
  feedItems: TeamFeedItem[]
  agentFilter?: Set<string>
  onClickAgent?: (agentName: string) => void
}

export function TeamFeed({
  feedItems,
  agentFilter,
  onClickAgent,
}: TeamFeedProps) {
  const filtered = useMemo(() => {
    let items = feedItems
    // Filter by agent
    if (agentFilter && agentFilter.size > 0) {
      items = items.filter(item => {
        const agent = getFeedItemAgent(item)
        // System messages pass through when filtering (context)
        if (item.type === "system") return true
        // User messages targeted to a filtered agent pass through
        if (item.type === "user" && item.target && agentFilter.has(item.target)) return true
        // User messages without target pass through (broadcasts)
        if (item.type === "user" && !item.target) return true
        // Agent-to-agent messages pass if either participant matches
        if (item.type === "agent-message") return agentFilter.has(item.from) || agentFilter.has(item.to)
        // Agent items pass if agent matches
        return agent !== null && agentFilter.has(agent)
      })
    }
    return items
  }, [feedItems, agentFilter])

  return (
    <ScrollArea className="flex-1 overflow-y-auto dotted-grid">
      <div className="max-w-3xl mx-auto w-full px-6 py-4 space-y-3">
        {filtered.map((item, i) => {
          switch (item.type) {
            case "system":
              return <SystemMessage key={i} text={item.text} />
            case "user":
              return <TeamUserMessage key={i} text={item.text} target={item.target} />
            case "summary":
              return (
                <AgentSummaryCard
                  key={i}
                  agent={item.agent}
                  summary={item.summary}
                  cost={item.cost}
                  turns={item.turns}
                  duration={item.duration}
                  isError={item.isError}
                  onClickAgent={onClickAgent}
                />
              )
            case "status":
              return <AgentStatusLine key={i} agent={item.agent} from={item.from} to={item.to} onClickAgent={onClickAgent} />
            case "error":
              return <TeamErrorAlert key={i} agent={item.agent} text={item.text} onClickAgent={onClickAgent} />
            case "question":
              return <QuestionCard key={i} agent={item.agent} question={item.question} options={item.options} />
            case "plan":
              return <PlanCard key={i} agent={item.agent} title={item.title} plan={item.plan} planStatus={item.planStatus} />
            case "permission":
              return <PermissionCard key={i} agent={item.agent} command={item.command} risk={item.risk} permStatus={item.permStatus} />
            case "multi-question":
              return <MultiQuestionCard key={i} agent={item.agent} questions={item.questions} />
            case "agent-message":
              return <AgentToAgentMessage key={i} from={item.from} to={item.to} text={item.text} onClickAgent={onClickAgent} />
            default:
              return null
          }
        })}
      </div>
    </ScrollArea>
  )
}
