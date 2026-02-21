"use client"

import { useEffect, useMemo, useCallback } from "react"
import { useParams } from "next/navigation"
import { useMutation, useQuery } from "@apollo/client"
import { useUIStore } from "@/stores/ui"
import { useAgents } from "@/hooks/use-agents"
import { useFeed } from "@/hooks/use-feed"
import { PROJECT_QUERY } from "@/lib/graphql/queries"
import {
  SEND_MESSAGE_MUTATION,
  BROADCAST_MESSAGE_MUTATION,
} from "@/lib/graphql/mutations"
import { Header } from "@/components/layout/header"
import { FeedContainer } from "@/components/feed/feed-container"
import { Composer } from "@/components/composer/composer"
import type { Project } from "@/types"

export default function ProjectPage() {
  const params = useParams()
  const projectId = params.projectId as string

  const selectedAgentId = useUIStore((s) => s.selectedAgentId)
  const selectAgent = useUIStore((s) => s.selectAgent)
  const selectProject = useUIStore((s) => s.selectProject)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  // Sync project selection with URL
  useEffect(() => {
    if (projectId) {
      selectProject(projectId)
    }
  }, [projectId, selectProject])

  // Fetch project details
  const { data: projectData } = useQuery(PROJECT_QUERY, {
    variables: { id: projectId },
    skip: !projectId,
  })
  const project: Project | null = projectData?.project ?? null

  // Fetch agents
  const { agents } = useAgents(projectId)

  // Fetch feed — agent-specific or project-wide
  const { items, loading, loadMore } = useFeed({
    projectId,
    agentId: selectedAgentId ?? undefined,
  })

  // Total cost across all agents
  const totalCost = useMemo(
    () =>
      agents.reduce(
        (sum, a) => sum + (parseFloat(a.sessionCostUsd) || 0),
        0,
      ),
    [agents],
  )

  // Send message
  const [sendMessage] = useMutation(SEND_MESSAGE_MUTATION)
  const [broadcastMessage] = useMutation(BROADCAST_MESSAGE_MUTATION)

  const handleSend = useCallback(
    async (message: string, agentId?: string) => {
      const targetId = agentId || selectedAgentId

      if (targetId) {
        // Send to specific agent
        await sendMessage({
          variables: { input: { agentId: targetId, message } },
        })
      } else {
        // Broadcast to all agents in this project
        const agentIds = agents.map((a) => a.id)
        if (agentIds.length > 0) {
          await broadcastMessage({
            variables: { input: { agentIds, message } },
          })
        }
      }
    },
    [selectedAgentId, agents, sendMessage, broadcastMessage],
  )

  return (
    <div className="flex flex-col flex-1 min-h-0 dotted-grid">
      <Header
        projectName={project?.name}
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={selectAgent}
        onToggleSidebar={toggleSidebar}
        totalCost={totalCost}
      />

      <FeedContainer
        items={items}
        loading={loading}
        onLoadMore={loadMore}
      />

      <Composer
        onSend={handleSend}
        agents={agents}
        selectedAgentId={selectedAgentId}
        disabled={agents.length === 0}
      />
    </div>
  )
}
