import { useQuery, useSubscription, useMutation, useApolloClient } from "@apollo/client"
import { useCallback, useEffect, useMemo } from "react"
import { useParams } from "next/navigation"
import type { DocumentNode } from "graphql"
import { GET_FEED, GET_AGENT_FEED } from "@/lib/graphql/queries/feed"
import { ON_FEED_ITEM_CHANGED } from "@/lib/graphql/subscriptions/feed"
import { ON_EVENT_STREAM } from "@/lib/graphql/subscriptions/agents"
import { RESOLVE_PERMISSION, RESOLVE_PLAN } from "@/lib/graphql/mutations/agents"
import { SEND_MESSAGE } from "@/lib/graphql/mutations/feed"
import { deriveAttentionFromFeed } from "@/lib/attention"
import { createLogger } from "@/lib/logger"
import type { TeamFeedItem, TimelineEntry, RecipientEntry } from "@/lib/types"

/* ================================================================== */
/*  FEED HOOKS                                                          */
/*                                                                      */
/*  cache-and-network + subscription for live updates.                  */
/* ================================================================== */

const log = createLogger("apollo")

type FeedData = { feed: TeamFeedItem[] }

/* ── Query + subscription ────────────────────────────────────────── */

/** Query-only hook — call from any component. */
export function useFeed() {
  const { projectId } = useParams<{ projectId: string }>()
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  return useQuery<FeedData>(GET_FEED, {
    fetchPolicy: "cache-and-network",
    variables: queryVars,
    skip: !projectId,
  })
}

/** Subscription hook — call ONCE from the page-level component. */
export function useFeedSubscription() {
  const { projectId } = useParams<{ projectId: string }>()
  const client = useApolloClient()
  const queryVars = useMemo(() => ({ projectId }), [projectId])

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
}

/* ── Agent detail feed (per-agent timeline) ────────────────────── */

type AgentFeedData = { agentFeed: TimelineEntry[] }
type EventStreamData = { eventStream: TimelineEntry }

/** Fetches agent-specific timeline entries with real-time updates via event_stream subscription. */
export function useAgentFeed(agentId: string) {
  const { projectId } = useParams<{ projectId: string }>()

  const result = useQuery<AgentFeedData>(GET_AGENT_FEED, {
    variables: { agentId },
    skip: !agentId,
    fetchPolicy: "cache-and-network",
  })

  // Subscribe to event_stream for real-time updates, filtered to this agent
  useEffect(() => {
    if (!agentId || !projectId) return
    const unsub = result.subscribeToMore<EventStreamData>({
      document: ON_EVENT_STREAM,
      variables: { projectId },
      updateQuery: (prev, { subscriptionData }) => {
        const entry = subscriptionData.data?.eventStream
        if (!entry || entry.agentId !== agentId) return prev
        // Skip stream_event (phase transitions) — same as backend query filter
        if (entry.entryType === "stream_event") return prev

        const existing = prev.agentFeed ?? []
        if (existing.some(e => e.id === entry.id)) return prev

        log("agent_feed.subscription_append", { id: entry.id, type: entry.entryType, agent: agentId })
        return { agentFeed: [...existing, entry] }
      },
    })
    return unsub
  }, [agentId, projectId, result.subscribeToMore])

  return result
}

/* ── Resolve hooks (permission + plan) ───────────────────────────── */

/**
 * Shared logic for resolving actionable feed items (permissions, plans).
 * Both follow the same flow: optimistic cache update → derive attention → fire mutation.
 *
 * extraVars allows callers to append additional mutation variables (e.g. alwaysAllow).
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
    (feedItemId: string, verdict: string, extraVars?: Record<string, unknown>) => {
      log("cache.modify", { typename: "TeamFeedItemType", id: feedItemId, field: statusField, value: verdict })

      // 1. Optimistic cache update on the FeedItem
      client.cache.modify({
        id: client.cache.identify({ __typename: "TeamFeedItemType", id: feedItemId }),
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
        const agentId = "agentId" in item ? item.agentId : undefined
        const newAttention = deriveAttentionFromFeed(feed, agentName)
        log("cache.modify", { typename: "AgentType", agent: agentName, field: "attentionLevel", value: newAttention, reason: `${itemType} resolved` })

        if (agentId) {
          client.cache.modify({
            id: client.cache.identify({ __typename: "AgentType", id: agentId }),
            fields: { attentionLevel: () => newAttention },
          })
        }
      }

      // 3. Fire mutation to backend
      mutate({ variables: { feedItemId, verdict, ...extraVars } }).catch(err => {
        log("mutation.error", { mutation: itemType === "permission" ? "resolvePermission" : "resolvePlan", feedItemId, error: err.message })
        // Revert optimistic update — set status back to pending
        client.cache.modify({
          id: client.cache.identify({ __typename: "TeamFeedItemType", id: feedItemId }),
          fields: { [statusField]: () => "pending" },
        })
      })
    },
    [client, mutate, queryVars, statusField, itemType],
  )
}

export function useResolvePermission() {
  const resolve = useResolveFeedItem(RESOLVE_PERMISSION, "permStatus", "permission")

  return useCallback(
    (feedItemId: string, verdict: string, alwaysAllow?: boolean) => {
      resolve(feedItemId, verdict, { alwaysAllow: alwaysAllow ?? false })
    },
    [resolve],
  )
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

      mutate({ variables: { projectId, text, recipients: recipientInputs } }).catch(err => {
        log("mutation.error", { mutation: "sendMessage", error: err.message })
      })
    },
    [mutate, projectId],
  )
}
