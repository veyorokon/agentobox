"use client"

import { useEffect, useMemo, useCallback, useState, useRef } from "react"
import { useParams } from "next/navigation"
import { useMutation, useQuery } from "@apollo/client"
import { useUIStore } from "@/stores/ui"
import { useAgents } from "@/hooks/use-agents"
import { useFeed } from "@/hooks/use-feed"
import { PROJECT_QUERY } from "@/lib/graphql/queries"
import {
  SEND_MESSAGE_MUTATION,
  BROADCAST_MESSAGE_MUTATION,
  KILL_AGENT_MUTATION,
  REMOVE_AGENT_MUTATION,
  RESTART_AGENT_MUTATION,
  SET_AGENT_MODE_MUTATION,
  CLEAR_AGENT_SESSION_MUTATION,
  INTERRUPT_AGENT_MUTATION,
} from "@/lib/graphql/mutations"
import { Header } from "@/components/layout/header"
import { SessionInfoBar } from "@/components/layout/session-info-bar"
import { FeedContainer } from "@/components/feed/feed-container"
import { Composer } from "@/components/composer/composer"
import type { Agent, Project } from "@/types"

export default function ProjectPage() {
  const params = useParams()
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0] ?? ''

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
  const { items, loading } = useFeed({
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

  // Currently selected agent (null when "All")
  const selectedAgent: Agent | null = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )

  // Names of currently running agents (for thinking indicator)
  const runningAgentNames = useMemo(() => {
    const relevant = selectedAgentId
      ? agents.filter((a) => a.id === selectedAgentId)
      : agents
    return relevant.filter((a) => a.status === "running").map((a) => a.name)
  }, [agents, selectedAgentId])

  // Toast helper
  const addToast = useUIStore((s) => s.addToast)

  // Send message
  const [sendMessage] = useMutation(SEND_MESSAGE_MUTATION)
  const [broadcastMessage] = useMutation(BROADCAST_MESSAGE_MUTATION)

  // Agent action mutations
  const [killAgent] = useMutation(KILL_AGENT_MUTATION)
  const [removeAgent] = useMutation(REMOVE_AGENT_MUTATION)
  const [restartAgent] = useMutation(RESTART_AGENT_MUTATION)
  const [setAgentMode] = useMutation(SET_AGENT_MODE_MUTATION)
  const [clearAgentSession] = useMutation(CLEAR_AGENT_SESSION_MUTATION)
  const [interruptAgent] = useMutation(INTERRUPT_AGENT_MUTATION)

  const handleSend = useCallback(
    async (message: string, agentId?: string) => {
      const targetId = agentId || selectedAgentId

      // Optimistically show stop button
      if (targetId) setOptimisticStreaming(true)

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

  // Agent action handlers
  const handleKillAgent = useCallback(
    async (agentId: string) => {
      try {
        await killAgent({ variables: { agentId } })
        addToast({ message: "Agent killed", type: "success" })
      } catch {
        addToast({ message: "Failed to kill agent", type: "error" })
      }
    },
    [killAgent, addToast],
  )

  const handleRemoveAgent = useCallback(
    async (agentId: string) => {
      try {
        await removeAgent({ variables: { agentId } })
        addToast({ message: "Agent removed", type: "success" })
        // Deselect if this was the selected agent
        if (selectedAgentId === agentId) {
          selectAgent(null)
        }
      } catch {
        addToast({ message: "Failed to remove agent", type: "error" })
      }
    },
    [removeAgent, addToast, selectedAgentId, selectAgent],
  )

  const handleRestartAgent = useCallback(
    async (agentId: string) => {
      try {
        await restartAgent({ variables: { agentId } })
        addToast({ message: "Agent restarted", type: "success" })
      } catch {
        addToast({ message: "Failed to restart agent", type: "error" })
      }
    },
    [restartAgent, addToast],
  )

  const handleSetAgentMode = useCallback(
    async (agentId: string, mode: string) => {
      try {
        await setAgentMode({ variables: { agentId, mode } })
        addToast({ message: `Mode set to ${mode}`, type: "success" })
      } catch {
        addToast({ message: "Failed to set agent mode", type: "error" })
      }
    },
    [setAgentMode, addToast],
  )

  const handleClearAgentSession = useCallback(
    async (agentId: string) => {
      try {
        await clearAgentSession({ variables: { agentId } })
        addToast({ message: "Session cleared", type: "success" })
      } catch {
        addToast({ message: "Failed to clear session", type: "error" })
      }
    },
    [clearAgentSession, addToast],
  )

  const handleInterrupt = useCallback(async () => {
    const targetId = selectedAgentId
    if (!targetId) return
    try {
      await interruptAgent({ variables: { agentId: targetId } })
    } catch {
      addToast({ message: "Failed to interrupt agent", type: "error" })
    }
    setOptimisticStreaming(false)
  }, [selectedAgentId, interruptAgent, addToast])

  // Optimistic streaming: set true on send, cleared on result event or interrupt.
  // This makes the stop button appear immediately without waiting for the
  // backend status roundtrip (which can be slower than a 1-2s agent turn).
  const [optimisticStreaming, setOptimisticStreaming] = useState(false)
  const lastResultCountRef = useRef(0)

  // Clear optimistic streaming when a new result event appears for selected agent
  const resultCount = useMemo(() => {
    if (!selectedAgentId) return 0
    return items.filter(
      (i) => i.entryType === "result" && i.agentId === selectedAgentId,
    ).length
  }, [items, selectedAgentId])

  useEffect(() => {
    if (resultCount > lastResultCountRef.current) {
      setOptimisticStreaming(false)
    }
    lastResultCountRef.current = resultCount
  }, [resultCount])

  // Clear optimistic streaming when agent selection changes
  useEffect(() => {
    setOptimisticStreaming(false)
  }, [selectedAgentId])

  const isStreaming =
    optimisticStreaming || selectedAgent?.status === "running"

  const agentActions = useMemo(
    () => ({
      onKillAgent: handleKillAgent,
      onRemoveAgent: handleRemoveAgent,
      onRestartAgent: handleRestartAgent,
      onSetAgentMode: handleSetAgentMode,
      onClearAgentSession: handleClearAgentSession,
    }),
    [handleKillAgent, handleRemoveAgent, handleRestartAgent, handleSetAgentMode, handleClearAgentSession],
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
        agentActions={agentActions}
      />
      <SessionInfoBar agent={selectedAgent} />

      <FeedContainer
        items={items}
        loading={loading}
        hasAgents={agents.length > 0}
        runningAgentNames={runningAgentNames}
      />

      <Composer
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        onSetAgentMode={handleSetAgentMode}
        onSelectAgent={selectAgent}
        agents={agents}
        selectedAgentId={selectedAgentId}
        isStreaming={isStreaming}
        disabled={agents.length === 0}
      />
    </div>
  )
}
