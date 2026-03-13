/**
 * Central cache reconciliation for Apollo.
 *
 * Invariant: WS is authoritative. Optimistic updates are temporary overlays —
 * WS will correct any divergence on the next push.
 *
 * All cache writes route through these functions. WS handlers call the snapshot/
 * upsert functions. Mutation hooks call the optimistic functions which return
 * rollback closures for error handling.
 */

import type { ApolloClient, ApolloCache } from "@apollo/client/core"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { GET_FEED } from "@/lib/graphql/queries/feed"
import { deriveAttentionFromFeed } from "@/lib/attention"
import { gql } from "@apollo/client"
import { createLogger } from "@/lib/logger"
import type { TeamFeedItem } from "@/lib/types"

const log = createLogger("cache-ops")

// ---------------------------------------------------------------------------
// WS authoritative writes
// ---------------------------------------------------------------------------

/** Replace full snapshot (WS reconnect/initial load) */
export function applySnapshot(
  client: ApolloClient,
  projectId: string,
  agents: Record<string, unknown>[],
  feed: Record<string, unknown>[],
): void {
  log("snapshot", { agents: agents.length, feed: feed.length })

  client.writeQuery({
    query: GET_AGENTS,
    variables: { projectId },
    data: { agents },
  })

  client.writeQuery({
    query: GET_FEED,
    variables: { projectId },
    data: { feed },
  })
}

/** Upsert single agent from WS incremental update */
export function upsertAgent(
  client: ApolloClient,
  projectId: string,
  agentData: Record<string, unknown>,
): void {
  const agentId = agentData.id as string
  log("upsert_agent", { agentId, name: agentData.name })

  const existing = client.readQuery<{ agents: Record<string, unknown>[] }>({
    query: GET_AGENTS,
    variables: { projectId },
  })

  const currentAgents = existing?.agents ?? []
  const idx = currentAgents.findIndex((a: Record<string, unknown>) => a.id === agentId)

  let updatedAgents: Record<string, unknown>[]
  if (idx >= 0) {
    updatedAgents = [...currentAgents]
    updatedAgents[idx] = agentData
  } else {
    updatedAgents = [...currentAgents, agentData]
  }

  client.writeQuery({
    query: GET_AGENTS,
    variables: { projectId },
    data: { agents: updatedAgents },
  })

  client.refetchQueries({ include: ["GetAgentFeed"] })
}

/** Upsert single feed item from WS incremental update */
export function upsertFeedItem(
  client: ApolloClient,
  projectId: string,
  feedData: Record<string, unknown>,
): void {
  const feedId = feedData.id as string
  log("upsert_feed", { feedId, type: feedData.type })

  const existing = client.readQuery<{ feed: Record<string, unknown>[] }>({
    query: GET_FEED,
    variables: { projectId },
  })

  const currentFeed = existing?.feed ?? []
  const idx = currentFeed.findIndex((f: Record<string, unknown>) => f.id === feedId)

  let updatedFeed: Record<string, unknown>[]
  if (idx >= 0) {
    updatedFeed = [...currentFeed]
    updatedFeed[idx] = feedData
  } else {
    updatedFeed = [...currentFeed, feedData]
  }

  client.writeQuery({
    query: GET_FEED,
    variables: { projectId },
    data: { feed: updatedFeed },
  })
}

// ---------------------------------------------------------------------------
// Optimistic updates (return rollback functions)
// ---------------------------------------------------------------------------

/** Optimistic: set agent field, returns rollback function */
export function optimisticAgentField(
  cache: ApolloCache,
  agentId: string,
  field: string,
  value: unknown,
): () => void {
  const cacheId = cache.identify({ __typename: "AgentType", id: agentId })
  const fragmentDoc = gql`fragment ${field}Snap on AgentType { ${field} }`

  const prev = cache.readFragment<Record<string, unknown>>({
    id: cacheId,
    fragment: fragmentDoc,
  })

  cache.modify({
    id: cacheId,
    fields: { [field]: () => value },
  })

  return () => {
    if (prev && field in prev) {
      cache.modify({
        id: cacheId,
        fields: { [field]: () => prev[field] },
      })
    }
  }
}

/** Optimistic: resolve feed item + derive agent attention, returns rollback */
export function optimisticFeedResolve(
  client: ApolloClient,
  projectId: string,
  feedItemId: string,
  statusField: "permStatus" | "planStatus",
  verdict: string,
  itemType: "permission" | "plan",
): () => void {
  const cache = client.cache

  // 1. Update feed item status
  cache.modify({
    id: cache.identify({ __typename: "TeamFeedItemType", id: feedItemId }),
    fields: { [statusField]: () => verdict },
  })

  // 2. Derive and update agent attention
  const feedData = client.readQuery<{ feed: TeamFeedItem[] }>({
    query: GET_FEED,
    variables: { projectId },
  })
  const feed = feedData?.feed ?? []
  const item = feed.find((fi: TeamFeedItem) => fi.id === feedItemId)
  let prevAttention: string | undefined

  if (item && item.type === itemType) {
    const agentName = item.agent
    const agentId = "agentId" in item ? item.agentId : undefined
    const newAttention = deriveAttentionFromFeed(feed, agentName)

    if (agentId) {
      const agentCacheId = cache.identify({ __typename: "AgentType", id: agentId })
      const snap = cache.readFragment<{ attentionLevel: string }>({
        id: agentCacheId,
        fragment: gql`fragment AttnSnap on AgentType { attentionLevel }`,
      })
      prevAttention = snap?.attentionLevel

      cache.modify({
        id: agentCacheId,
        fields: { attentionLevel: () => newAttention },
      })
    }
  }

  // Return rollback
  return () => {
    cache.modify({
      id: cache.identify({ __typename: "TeamFeedItemType", id: feedItemId }),
      fields: { [statusField]: () => "pending" },
    })

    if (item && "agentId" in item && item.agentId) {
      const revertFeed = client.readQuery<{ feed: TeamFeedItem[] }>({
        query: GET_FEED,
        variables: { projectId },
      })
      const revertAttention = deriveAttentionFromFeed(revertFeed?.feed ?? [], item.agent)
      cache.modify({
        id: cache.identify({ __typename: "AgentType", id: item.agentId }),
        fields: { attentionLevel: () => revertAttention },
      })
    }
  }
}
