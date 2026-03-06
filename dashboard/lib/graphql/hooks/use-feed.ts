import { useQuery, useMutation, useApolloClient } from "@apollo/client/react"
import { useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import type { DocumentNode } from "graphql"
import { GET_FEED, GET_AGENT_FEED } from "@/lib/graphql/queries/feed"
import { RESOLVE_PERMISSION, RESOLVE_PLAN } from "@/lib/graphql/mutations/agents"
import { SEND_MESSAGE } from "@/lib/graphql/mutations/feed"
import { deriveAttentionFromFeed } from "@/lib/attention"
import { createLogger } from "@/lib/logger"
import type { TeamFeedItem, TimelineEntry, RecipientEntry } from "@/lib/types"

/* ================================================================== */
/*  FEED HOOKS                                                          */
/*                                                                      */
/*  cache-and-network. Real-time updates via useProjectWebSocket.       */
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

/* ── Agent detail feed (per-agent timeline) ────────────────────── */

type AgentFeedData = { agentFeed: TimelineEntry[] }

/** Fetches agent-specific timeline entries. */
export function useAgentFeed(agentId: string) {
  return useQuery<AgentFeedData>(GET_AGENT_FEED, {
    variables: { agentId },
    skip: !agentId,
    fetchPolicy: "cache-and-network",
  })
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
  const [mutate] = useMutation<{ sendMessage: boolean }>(SEND_MESSAGE)

  return useCallback(
    async (text: string, recipients: RecipientEntry[]): Promise<boolean> => {
      if (!projectId) return false

      const recipientInputs = recipients.map(r => {
        if (r.type === "all") return { type: "all", value: "" }
        return { type: r.type, value: r.value }
      })

      try {
        const { data } = await mutate({
          variables: { projectId, text, recipients: recipientInputs },
        })
        return data?.sendMessage ?? false
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        log("mutation.error", { mutation: "sendMessage", error: message })
        return false
      }
    },
    [mutate, projectId],
  )
}
