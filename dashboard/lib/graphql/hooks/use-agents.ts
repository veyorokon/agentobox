import { useQuery, useSubscription, useMutation, useApolloClient } from "@apollo/client"
import { useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { ON_AGENT_CHANGED } from "@/lib/graphql/subscriptions/agents"
import {
  SET_AGENT_MODE,
  KILL_AGENT,
  REMOVE_AGENT,
  HARD_RESTART_AGENT,
  RESTART_AGENT,
  UPDATE_AGENT_INSTRUCTIONS,
  UPDATE_AGENT_CONFIG,
} from "@/lib/graphql/mutations/agents"
import { createLogger } from "@/lib/logger"
import type { Agent, AttentionLevel } from "@/lib/types"

/* ================================================================== */
/*  AGENT HOOKS                                                         */
/*                                                                      */
/*  cache-and-network + subscription for live updates.                  */
/* ================================================================== */

const log = createLogger("apollo")

type AgentsData = { agents: Agent[] }

export function useAgents() {
  const { projectId } = useParams<{ projectId: string }>()
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  const result = useQuery<AgentsData>(GET_AGENTS, {
    fetchPolicy: "cache-and-network",
    variables: queryVars,
    skip: !projectId,
  })

  // Real-time agent updates via subscription
  useSubscription(ON_AGENT_CHANGED, {
    variables: { projectId: projectId ?? "" },
    skip: !projectId,
    onData: ({ client, data: subData }) => {
      const agent = subData.data?.agentChanged
      if (!agent) return
      log("subscription.agent_changed", { id: agent.id })

      // Merge into cache — Apollo auto-merges by keyFields (id)
      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agent.id }),
        fields: {
          lifecycleStatus: () => agent.lifecycleStatus,
          attentionLevel: () => agent.attentionLevel,
          mode: () => agent.mode,
          cost: () => agent.cost,
          duration: () => agent.duration,
          turns: () => agent.turns,
          phase: () => agent.phase,
          task: () => agent.task,
          liveAction: () => agent.liveAction,
          todoProgress: () => agent.todoProgress,
        },
      })
    },
  })

  return result
}

export function useSetAgentMode() {
  const client = useApolloClient()
  const [mutate] = useMutation(SET_AGENT_MODE)

  return useCallback(
    (agentId: string, mode: Agent["mode"]) => {
      log("cache.modify", { typename: "Agent", id: agentId, field: "mode", value: mode })

      // Optimistic cache update
      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agentId }),
        fields: {
          mode: () => mode,
        },
      })

      mutate({ variables: { agentId, mode } })
    },
    [client, mutate],
  )
}

export function useAcknowledgeAgent() {
  const client = useApolloClient()

  return useCallback(
    (agentId: string) => {
      log("cache.modify", { typename: "Agent", id: agentId, field: "attentionLevel", action: "acknowledge" })
      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agentId }),
        fields: {
          attentionLevel: (current: AttentionLevel) =>
            current === "review" ? "none" : current,
        },
      })
    },
    [client],
  )
}

/* ================================================================== */
/*  LIFECYCLE HOOKS                                                     */
/* ================================================================== */

export function useKillAgent() {
  const [mutate] = useMutation(KILL_AGENT)
  return useCallback((agentId: string) => {
    mutate({ variables: { agentId } })
  }, [mutate])
}

export function useRemoveAgent() {
  const [mutate] = useMutation(REMOVE_AGENT)
  return useCallback((agentId: string) => {
    mutate({ variables: { agentId } })
  }, [mutate])
}

export function useHardRestartAgent() {
  const [mutate] = useMutation(HARD_RESTART_AGENT)
  return useCallback((agentId: string) => {
    mutate({ variables: { agentId } })
  }, [mutate])
}

export function useRestartAgent() {
  const [mutate] = useMutation(RESTART_AGENT)
  return useCallback((agentId: string) => {
    mutate({ variables: { agentId } })
  }, [mutate])
}

export function useUpdateAgentInstructions() {
  const [mutate] = useMutation(UPDATE_AGENT_INSTRUCTIONS)
  return useCallback((agentId: string, instructions: string) => {
    mutate({ variables: { input: { agentId, instructions } } })
  }, [mutate])
}

export function useUpdateAgentConfig() {
  const [mutate] = useMutation(UPDATE_AGENT_CONFIG)
  return useCallback((agentId: string, config: { model?: string; role?: string; tags?: string[]; mcpRegistryNames?: string[] }) => {
    mutate({ variables: { input: { agentId, ...config } } })
  }, [mutate])
}
