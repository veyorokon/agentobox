import { useQuery, useApolloClient } from "@apollo/client"
import { useCallback } from "react"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { createLogger } from "@/lib/logger"
import type { Agent, AttentionLevel } from "@/lib/types"

/* ================================================================== */
/*  AGENT HOOKS                                                         */
/*                                                                      */
/*  Thin wrappers over Apollo hooks. Exist so that:                    */
/*  1. fetchPolicy is set once, not in every component                 */
/*  2. Dev-phase logic (cache-only) is centralized                     */
/*  3. Components import from one place, not @apollo/client directly   */
/*                                                                      */
/*  When switching from mock to real backend, only this file changes.  */
/* ================================================================== */

const log = createLogger("apollo")

type AgentsData = { agents: Agent[] }

export function useAgents() {
  return useQuery<AgentsData>(GET_AGENTS, { fetchPolicy: "cache-only" })
}

export function useSetAgentMode() {
  const client = useApolloClient()

  return useCallback(
    (agentId: string, mode: Agent["mode"]) => {
      log("cache.modify", { typename: "Agent", id: agentId, field: "mode", value: mode })
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
