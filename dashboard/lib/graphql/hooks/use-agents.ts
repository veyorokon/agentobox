import { gql } from "@apollo/client"
import { useQuery, useMutation, useApolloClient } from "@apollo/client/react"
import { useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import {
  SET_AGENT_MODE,
  KILL_AGENT,
  REMOVE_AGENT,
  HARD_RESTART_AGENT,
  RESTART_AGENT,
  INTERRUPT_AGENT,
  CLEAR_AGENT_SESSION,
  UPDATE_AGENT_INSTRUCTIONS,
  UPDATE_AGENT_CONFIG,
  CREATE_AGENT,
} from "@/lib/graphql/mutations/agents"
import { optimisticAgentField } from "@/lib/graphql/cache-ops"
import { createLogger } from "@/lib/logger"
import type { Agent, AttentionLevel, McpServerConfig } from "@/lib/types"

/* ================================================================== */
/*  AGENT HOOKS                                                         */
/*                                                                      */
/*  Query hook (useAgents) is safe to call from multiple components —   */
/*  Apollo deduplicates queries. Real-time via useProjectWebSocket.     */
/* ================================================================== */

const log = createLogger("apollo")
const inFlightHardRestarts = new Set<string>()
const RESTART_STATUS_FRAGMENT = gql`
  fragment RestartStatus on AgentType {
    lifecycleStatus
  }
`

type AgentsData = { agents: Agent[] }

/** Query-only hook — call from any component. */
export function useAgents() {
  const { projectId } = useParams<{ projectId: string }>()
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  return useQuery<AgentsData>(GET_AGENTS, {
    fetchPolicy: "cache-and-network",
    variables: queryVars,
    skip: !projectId,
  })
}

export function useSetAgentMode() {
  const client = useApolloClient()
  const [mutate] = useMutation(SET_AGENT_MODE)

  return useCallback(
    (agentId: string, mode: Agent["mode"]) => {
      log("cache.modify", { typename: "AgentType", id: agentId, field: "mode", value: mode })

      const rollback = optimisticAgentField(client.cache, agentId, "mode", mode)

      mutate({ variables: { agentId, mode } }).catch(err => {
        log("mutation.error", { mutation: "setAgentMode", agentId, error: err.message })
        rollback()
      })
    },
    [client, mutate],
  )
}

export function useAcknowledgeAgent() {
  const client = useApolloClient()

  return useCallback(
    (agentId: string) => {
      log("cache.modify", { typename: "AgentType", id: agentId, field: "attentionLevel", action: "acknowledge" })
      client.cache.modify({
        id: client.cache.identify({ __typename: "AgentType", id: agentId }),
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
    mutate({ variables: { agentId } }).catch(err => {
      log("mutation.error", { mutation: "killAgent", agentId, error: err.message })
    })
  }, [mutate])
}

export function useRemoveAgent() {
  const client = useApolloClient()
  const [mutate] = useMutation(REMOVE_AGENT)
  return useCallback((agentId: string) => {
    log("cache.evict", { typename: "AgentType", id: agentId })
    client.cache.evict({ id: client.cache.identify({ __typename: "AgentType", id: agentId }) })
    client.cache.gc()
    mutate({ variables: { agentId } }).catch(err => {
      log("mutation.error", { mutation: "removeAgent", agentId, error: err.message })
    })
  }, [client, mutate])
}

export function useHardRestartAgent() {
  const client = useApolloClient()
  const [mutate] = useMutation(HARD_RESTART_AGENT)
  return useCallback((agentId: string) => {
    if (inFlightHardRestarts.has(agentId)) {
      log("mutation.skipped", { mutation: "hardRestartAgent", agentId, reason: "in_flight" })
      return
    }
    const cacheId = client.cache.identify({ __typename: "AgentType", id: agentId })
    const cached = cacheId
      ? client.cache.readFragment<{ lifecycleStatus?: string }>({
          id: cacheId,
          fragment: RESTART_STATUS_FRAGMENT,
        })
      : null
    if (cached?.lifecycleStatus === "deploying") {
      log("mutation.skipped", { mutation: "hardRestartAgent", agentId, reason: "already_deploying" })
      return
    }

    inFlightHardRestarts.add(agentId)
    log("cache.modify", { typename: "AgentType", id: agentId, field: "lifecycleStatus", value: "deploying" })
    const rollback = optimisticAgentField(client.cache, agentId, "lifecycleStatus", "deploying")
    mutate({ variables: { agentId } })
      .catch(err => {
        log("mutation.error", { mutation: "hardRestartAgent", agentId, error: err.message })
        rollback()
      })
      .finally(() => {
        inFlightHardRestarts.delete(agentId)
      })
  }, [client, mutate])
}

export function useRestartAgent() {
  const [mutate] = useMutation(RESTART_AGENT)
  return useCallback((agentId: string) => {
    log("mutation.restartAgent", { agentId })
    // No optimistic cache update — soft restart sends a signal to the relay,
    // the backend does NOT change lifecycleStatus or relayConnected.
    // Setting "deploying" here would desync the cache and kill VNC.
    mutate({ variables: { agentId } }).catch(err => {
      log("mutation.error", { mutation: "restartAgent", agentId, error: err.message })
    })
  }, [mutate])
}

export function useInterruptAgent() {
  const [mutate] = useMutation(INTERRUPT_AGENT)
  return useCallback((agentId: string) => {
    log("mutation.interruptAgent", { agentId })
    mutate({ variables: { agentId } }).catch(err => {
      log("mutation.error", { mutation: "interruptAgent", agentId, error: err.message })
    })
  }, [mutate])
}

export function useClearAgentSession() {
  const [mutate] = useMutation(CLEAR_AGENT_SESSION)
  return useCallback((agentId: string) => {
    log("mutation.clearAgentSession", { agentId })
    mutate({ variables: { agentId } }).catch(err => {
      log("mutation.error", { mutation: "clearAgentSession", agentId, error: err.message })
    })
  }, [mutate])
}

export function useUpdateAgentInstructions() {
  const { projectId } = useParams<{ projectId: string }>()
  const [mutate] = useMutation(UPDATE_AGENT_INSTRUCTIONS)
  return useCallback(async (agentId: string, instructions: string) => {
    await mutate({
      variables: { input: { agentId, instructions } },
      refetchQueries: [{ query: GET_AGENTS, variables: { projectId } }],
    })
  }, [mutate, projectId])
}

export function useUpdateAgentConfig() {
  const { projectId } = useParams<{ projectId: string }>()
  const [mutate] = useMutation(UPDATE_AGENT_CONFIG)
  return useCallback(async (agentId: string, config: {
    model?: string
    role?: string
    tags?: string[]
    mcpRegistryNames?: string[]
    mcpCustomServers?: Record<string, McpServerConfig>
  }) => {
    await mutate({
      variables: { input: { agentId, ...config } },
      refetchQueries: [{ query: GET_AGENTS, variables: { projectId } }],
    })
  }, [mutate, projectId])
}

/* ================================================================== */
/*  CREATE AGENT                                                         */
/* ================================================================== */

type CreateAgentInput = {
  projectId: string
  name: string
  model: string
  role: string
  mode: string
  instructions?: string
  tags?: string[]
}

export function useCreateAgent() {
  const { projectId } = useParams<{ projectId: string }>()
  const [mutate, { loading, error }] = useMutation(CREATE_AGENT, {
    refetchQueries: [{ query: GET_AGENTS, variables: { projectId } }],
  })

  const create = useCallback(
    (input: Omit<CreateAgentInput, "projectId">) => {
      if (!projectId) return Promise.reject(new Error("No projectId"))
      log("mutation.createAgent", { name: input.name, projectId })
      return mutate({
        variables: { input: { projectId, ...input } },
      }).catch(err => {
        log("mutation.error", { mutation: "createAgent", error: err.message })
        throw err
      })
    },
    [mutate, projectId],
  )

  return { create, loading, error }
}
