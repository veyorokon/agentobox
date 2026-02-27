import { useQuery, useSubscription, useMutation, useApolloClient } from "@apollo/client"
import { useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import type { DocumentNode } from "graphql"
import { GET_FEED } from "@/lib/graphql/queries/feed"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { ON_FEED_ITEM_CHANGED } from "@/lib/graphql/subscriptions/feed"
import { RESOLVE_PERMISSION, RESOLVE_PLAN } from "@/lib/graphql/mutations/agents"
import { SEND_MESSAGE } from "@/lib/graphql/mutations/feed"
import { deriveAttentionFromFeed } from "@/lib/attention"
import { createLogger } from "@/lib/logger"
import type { Agent, TeamFeedItem, RecipientEntry } from "@/lib/types"

/* ================================================================== */
/*  FEED HOOKS                                                          */
/*                                                                      */
/*  cache-and-network + subscription for live updates.                  */
/* ================================================================== */

const log = createLogger("apollo")

type FeedData = { feed: TeamFeedItem[] }

/* ── Query + subscription ────────────────────────────────────────── */

export function useFeed() {
  const { projectId } = useParams<{ projectId: string }>()
  const client = useApolloClient()
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  const result = useQuery<FeedData>(GET_FEED, {
    fetchPolicy: "cache-and-network",
    variables: queryVars,
    skip: !projectId,
  })

  // Real-time feed updates via subscription
  useSubscription(ON_FEED_ITEM_CHANGED, {
    variables: { projectId: projectId ?? "" },
    skip: !projectId,
    onData: ({ data: subData }) => {
      const item = subData.data?.feedItemChanged
      if (!item) return
      log("subscription.feed_item_changed", { id: item.id, type: item.type })

      // Upsert into feed cache
      const existing = client.readQuery<FeedData>({ query: GET_FEED, variables: queryVars })
      const feed = existing?.feed ?? []
      const idx = feed.findIndex(f => f.id === item.id)

      if (idx >= 0) {
        const updated = [...feed]
        updated[idx] = item
        client.writeQuery({ query: GET_FEED, variables: queryVars, data: { feed: updated } })
      } else {
        client.writeQuery({ query: GET_FEED, variables: queryVars, data: { feed: [...feed, item] } })
      }
    },
  })

  return result
}

/* ── Resolve hooks (permission + plan) ───────────────────────────── */

/**
 * Shared logic for resolving actionable feed items (permissions, plans).
 * Both follow the same flow: optimistic cache update → derive attention → fire mutation.
 */
function useResolveFeedItem(
  mutation: DocumentNode,
  statusField: "permStatus" | "planStatus",
  itemType: "permission" | "plan",
) {
  const client = useApolloClient()
  const [mutate] = useMutation(mutation)
  const { projectId } = useParams<{ projectId: string }>()
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  return useCallback(
    (feedItemId: string, verdict: string) => {
      log("cache.modify", { typename: "FeedItem", id: feedItemId, field: statusField, value: verdict })

      // 1. Optimistic cache update on the FeedItem
      client.cache.modify({
        id: client.cache.identify({ __typename: "FeedItem", id: feedItemId }),
        fields: {
          [statusField]: () => verdict,
        },
      })

      // 2. Derive and update agent attention
      const feedData = client.readQuery<FeedData>({ query: GET_FEED, variables: queryVars })
      const feed = feedData?.feed ?? []
      const item = feed.find(fi => fi.id === feedItemId)
      if (item && item.type === itemType) {
        const agentName = item.agent
        const newAttention = deriveAttentionFromFeed(feed, agentName)
        log("cache.modify", { typename: "Agent", agent: agentName, field: "attentionLevel", value: newAttention, reason: `${itemType} resolved` })

        const agentsData = client.readQuery<{ agents: Agent[] }>({ query: GET_AGENTS, variables: queryVars })
        const agent = agentsData?.agents.find(a => a.name === agentName)
        if (agent) {
          client.cache.modify({
            id: client.cache.identify({ __typename: "Agent", id: agent.id }),
            fields: { attentionLevel: () => newAttention },
          })
        }
      }

      // 3. Fire mutation to backend
      mutate({ variables: { feedItemId, verdict } })
    },
    [client, mutate, queryVars, statusField, itemType],
  )
}

export function useResolvePermission() {
  return useResolveFeedItem(RESOLVE_PERMISSION, "permStatus", "permission")
}

export function useResolvePlan() {
  return useResolveFeedItem(RESOLVE_PLAN, "planStatus", "plan")
}

/* ── Send message ────────────────────────────────────────────────── */

export function useSendMessage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [mutate] = useMutation(SEND_MESSAGE)

  return useCallback(
    (text: string, recipients: RecipientEntry[]) => {
      if (!projectId) return

      const recipientInputs = recipients.map(r => {
        if (r.type === "all") return { type: "all", value: "" }
        return { type: r.type, value: r.value }
      })

      mutate({ variables: { projectId, text, recipients: recipientInputs } })
    },
    [mutate, projectId],
  )
}
