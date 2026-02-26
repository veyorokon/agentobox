import { useQuery, useApolloClient } from "@apollo/client"
import { useCallback } from "react"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { deriveAttentionFromFeed } from "@/lib/attention"
import { useTeamStore } from "@/lib/stores/team"
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

/* ================================================================== */
/*  BRIDGE HOOKS — span team store (feedItems) + Apollo (agents)       */
/*                                                                      */
/*  resolvePermission/resolvePlan update feedItems in team store,       */
/*  then recompute attention and write it to the Apollo agent cache.    */
/*  These bridge hooks exist because data is split across two stores    */
/*  during the migration. When feedItems move to Apollo (Part 2b),     */
/*  these become pure Apollo cache operations.                          */
/* ================================================================== */

export function useResolvePermission() {
  const client = useApolloClient()

  return useCallback(
    (feedItemId: string, verdict: "allowed" | "denied") => {
      // 1. Update feedItems in team store
      useTeamStore.getState().resolvePermission(feedItemId, verdict)

      // 2. Recompute attention for the affected agent
      const feedItems = useTeamStore.getState().feedItems
      const item = feedItems.find(fi => fi.id === feedItemId)
      if (!item || item.type !== "permission") return

      const agentName = item.agent
      const newAttention = deriveAttentionFromFeed(feedItems, agentName)

      // 3. Find agent by name and update attention in Apollo cache
      const data = client.readQuery<{ agents: FakeAgent[] }>({ query: GET_AGENTS })
      const agent = data?.agents.find(a => a.name === agentName)
      if (!agent) return

      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agent.id }),
        fields: { attentionLevel: () => newAttention },
      })
    },
    [client],
  )
}

export function useResolvePlan() {
  const client = useApolloClient()

  return useCallback(
    (feedItemId: string, verdict: "approved" | "rejected") => {
      // 1. Update feedItems in team store
      useTeamStore.getState().resolvePlan(feedItemId, verdict)

      // 2. Recompute attention for the affected agent
      const feedItems = useTeamStore.getState().feedItems
      const item = feedItems.find(fi => fi.id === feedItemId)
      if (!item || item.type !== "plan") return

      const agentName = item.agent
      const newAttention = deriveAttentionFromFeed(feedItems, agentName)

      // 3. Find agent by name and update attention in Apollo cache
      const data = client.readQuery<{ agents: FakeAgent[] }>({ query: GET_AGENTS })
      const agent = data?.agents.find(a => a.name === agentName)
      if (!agent) return

      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agent.id }),
        fields: { attentionLevel: () => newAttention },
      })
    },
    [client],
  )
}
