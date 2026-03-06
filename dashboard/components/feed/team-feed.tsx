"use client"

import { useMemo, useCallback } from "react"
import { getFeedItemAgent } from "@/lib/attention"
import { useTeamStore } from "@/lib/stores/team"
import { useAgents } from "@/lib/graphql/hooks/use-agents"
import { useFeed } from "@/lib/graphql/hooks/use-feed"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SystemMessage } from "@/components/feed/system-message"
import { TeamUserMessage } from "@/components/feed/user-message"
import { AgentSummaryCard } from "@/components/feed/summary-card"
import { StatusBar } from "@/components/feed/status-bar"
import { AgentToAgentMessage } from "@/components/feed/agent-message"
import { TeamErrorAlert } from "@/components/feed/error-alert"
import { QuestionCard, MultiQuestionCard } from "@/components/feed/question-card"
import { PlanCard } from "@/components/feed/plan-card"
import { PermissionCard } from "@/components/feed/permission-card"
import { TaskFeedCard } from "@/components/feed/task-card"

export function TeamFeed() {
  // ── Store subscriptions ───────────────────────────────────────────
  const { data: feedData } = useFeed()
  const feedItems = feedData?.feed ?? []
  const recipients = useTeamStore(s => s.recipients)
  const { data } = useAgents()
  const agents = data?.agents ?? []
  const reviewAgent = useTeamStore(s => s.reviewAgent)
  const setMainTab = useSidebarStore(s => s.setMainTab)

  // ── Derived: effective agent filter from recipients ────────────────
  const isDefaultRecipient = recipients.length === 1 && recipients[0].type === "agent" && recipients[0].value === "team-lead"

  const agentFilter = useMemo(() => {
    if (isDefaultRecipient) return new Set<string>()
    if (recipients.some(r => r.type === "all")) return new Set<string>()
    if (recipients.length === 0) return new Set<string>()
    const names = new Set<string>()
    for (const r of recipients) {
      if (r.type === "agent") names.add(r.value)
      else if (r.type === "tag") for (const a of agents) { if (a.tags.includes(r.value)) names.add(a.name) }
    }
    return names
  }, [recipients, agents, isDefaultRecipient])

  // ── Handlers ──────────────────────────────────────────────────────
  const handleClickAgent = useCallback((agentName: string) => {
    reviewAgent(agentName)
    setMainTab("chat")
  }, [reviewAgent, setMainTab])

  // ── Filtered items ────────────────────────────────────────────────
  const { statusItems, nonStatusItems } = useMemo(() => {
    let items = feedItems
    if (agentFilter.size > 0) {
      items = items.filter(item => {
        const agent = getFeedItemAgent(item)
        if (item.type === "system") return true
        if (item.type === "user" && item.target && agentFilter.has(item.target)) return true
        if (item.type === "user" && !item.target) return true
        if (item.type === "agent-message") return agentFilter.has(item.from) || agentFilter.has(item.to)
        return agent !== null && agentFilter.has(agent)
      })
    }
    const status: Extract<typeof items[number], { type: "status" }>[] = []
    const rest: typeof items = []
    for (const item of items) {
      if (item.type === "status") status.push(item)
      else rest.push(item)
    }
    return { statusItems: status, nonStatusItems: rest }
  }, [feedItems, agentFilter])

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <StatusBar items={statusItems} onClickAgent={handleClickAgent} />
      <ScrollArea className="flex-1 overflow-y-auto dotted-grid">
        <div className="max-w-3xl mx-auto w-full px-3 @[640px]/main:px-6 py-4 space-y-3">
          {nonStatusItems.map((item) => {
            switch (item.type) {
              case "system":
                return <SystemMessage key={item.id} text={item.text} />
              case "user":
                return <TeamUserMessage key={item.id} text={item.text} target={item.target} />
              case "summary":
                return (
                  <AgentSummaryCard
                    key={item.id}
                    agent={item.agent}
                    summary={item.summary}
                    cost={item.cost}
                    turns={item.turns}
                    duration={item.duration}
                    isError={item.isError}
                    onClickAgent={handleClickAgent}
                  />
                )
              case "error":
                return <TeamErrorAlert key={item.id} agent={item.agent} text={item.text} onClickAgent={handleClickAgent} />
              case "question":
                return <QuestionCard key={item.id} agent={item.agent} question={item.question} options={item.options} />
              case "plan":
                return <PlanCard key={item.id} agent={item.agent} title={item.title} planStatus={item.planStatus} />
              case "permission":
                return <PermissionCard key={item.id} agent={item.agent} command={item.command} risk={item.risk} permStatus={item.permStatus} feedItemId={item.id} />
              case "multi-question":
                return <MultiQuestionCard key={item.id} agent={item.agent} questions={item.questions} />
              case "task":
                return <TaskFeedCard key={item.id} agent={item.agent} text={item.text} from={item.from} to={item.to} target={item.target} />
              case "agent-message":
                return <AgentToAgentMessage key={item.id} from={item.from} to={item.to} text={item.text} onClickAgent={handleClickAgent} />
              default:
                return null
            }
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
