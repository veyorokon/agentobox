import { useQuery, useMutation, useApolloClient, gql } from "@apollo/client"
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
  UPDATE_AGENT_INSTRUCTIONS,
  UPDATE_AGENT_CONFIG,
  CREATE_AGENT,
} from "@/lib/graphql/mutations/agents"
import { createLogger } from "@/lib/logger"
import type { Agent, AttentionLevel } from "@/lib/types"

/* ================================================================== */
/*  AGENT HOOKS                                                         */
/*                                                                      */
/*  Query hook (useAgents) is safe to call from multiple components —   */
/*  Apollo deduplicates queries. Real-time via useProjectWebSocket.     */
/* ================================================================== */

const log = createLogger("apollo")

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

      // Read previous value for rollback
      const prev = client.cache.readFragment<{ mode: string }>({
        id: client.cache.identify({ __typename: "AgentType", id: agentId }),
        fragment: gql`fragment ModeSnap on AgentType { mode }`,
      })

      // Optimistic cache update
      client.cache.modify({
        id: client.cache.identify({ __typename: "AgentType", id: agentId }),
        fields: {
          mode: () => mode,
        },
      })

      mutate({ variables: { agentId, mode } }).catch(err => {
        log("mutation.error", { mutation: "setAgentMode", agentId, error: err.message })
        if (prev) {
          client.cache.modify({
            id: client.cache.identify({ __typename: "AgentType", id: agentId }),
            fields: { mode: () => prev.mode },
          })
        }
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
    log("cache.modify", { typename: "AgentType", id: agentId, field: "lifecycleStatus", value: "deploying" })
    client.cache.modify({
      id: client.cache.identify({ __typename: "AgentType", id: agentId }),
      fields: { lifecycleStatus: () => "deploying" },
    })
    mutate({ variables: { agentId } }).catch(err => {
      log("mutation.error", { mutation: "hardRestartAgent", agentId, error: err.message })
    })
  }, [client, mutate])
}

export function useRestartAgent() {
  const client = useApolloClient()
  const [mutate] = useMutation(RESTART_AGENT)
  return useCallback((agentId: string) => {
    log("cache.modify", { typename: "AgentType", id: agentId, field: "lifecycleStatus", value: "deploying" })
    client.cache.modify({
      id: client.cache.identify({ __typename: "AgentType", id: agentId }),
      fields: { lifecycleStatus: () => "deploying" },
    })
    mutate({ variables: { agentId } }).catch(err => {
      log("mutation.error", { mutation: "restartAgent", agentId, error: err.message })
    })
  }, [client, mutate])
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

export function useUpdateAgentInstructions() {
  const [mutate] = useMutation(UPDATE_AGENT_INSTRUCTIONS)
  return useCallback((agentId: string, instructions: string) => {
    mutate({ variables: { input: { agentId, instructions } } }).catch(err => {
      log("mutation.error", { mutation: "updateAgentInstructions", agentId, error: err.message })
    })
  }, [mutate])
}

export function useUpdateAgentConfig() {
  const [mutate] = useMutation(UPDATE_AGENT_CONFIG)
  return useCallback((agentId: string, config: {
    model?: string
    role?: string
    tags?: string[]
    mcpRegistryNames?: string[]
    mcpCustomServers?: Record<string, { command: string; args: string[] }>
  }) => {
    mutate({ variables: { input: { agentId, ...config } } }).catch(err => {
      log("mutation.error", { mutation: "updateAgentConfig", agentId, error: err.message })
    })
  }, [mutate])
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
  runtime: string
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
