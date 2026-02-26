import { useQuery, useApolloClient } from "@apollo/client"
import { useCallback } from "react"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import type { FakeAgent, AttentionLevel, LifecycleStatus } from "@/lib/types"

/* ================================================================== */
/*  AGENT HOOKS                                                         */
/*                                                                      */
/*  Thin wrappers over Apollo hooks. Exist so that:                    */
/*  1. fetchPolicy is set once, not in every component                 */
/*  2. Mock-phase logic (cache-only) is centralized                    */
/*  3. Components import from one place, not @apollo/client directly   */
/*                                                                      */
/*  When switching from mock to real backend, only this file changes.  */
/* ================================================================== */

type AgentsData = { agents: FakeAgent[] }

export function useAgents() {
  return useQuery<AgentsData>(GET_AGENTS, { fetchPolicy: "cache-only" })
}

export function useSetAgentMode() {
  const client = useApolloClient()

  return useCallback(
    (agentId: string, mode: FakeAgent["mode"]) => {
      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agentId }),
        fields: {
          mode: () => mode,
        },
      })
    },
    [client],
  )
}

export function useSetAgentLifecycle() {
  const client = useApolloClient()

  return useCallback(
    (agentId: string, status: LifecycleStatus) => {
      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agentId }),
        fields: {
          lifecycleStatus: () => status,
        },
      })
    },
    [client],
  )
}

export function useSetAgentAttention() {
  const client = useApolloClient()

  return useCallback(
    (agentId: string, level: AttentionLevel) => {
      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agentId }),
        fields: {
          attentionLevel: () => level,
        },
      })
    },
    [client],
  )
}

export function useAcknowledgeAgent() {
  const client = useApolloClient()

  return useCallback(
    (agentId: string) => {
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
