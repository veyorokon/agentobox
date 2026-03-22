import { useQuery, useMutation, useApolloClient } from "@apollo/client/react"
import { useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import type { DocumentNode } from "graphql"
import { GET_FEED, GET_AGENT_FEED } from "@/lib/graphql/queries/feed"
import { RESOLVE_PERMISSION, RESOLVE_PLAN } from "@/lib/graphql/mutations/agents"
import { SEND_MESSAGE } from "@/lib/graphql/mutations/feed"
import { optimisticFeedResolve } from "@/lib/graphql/cache-ops"
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

  return useCallback(
    (feedItemId: string, verdict: string, extraVars?: Record<string, unknown>) => {
      if (!projectId) return

      log("cache.modify", { typename: "TeamFeedItemType", id: feedItemId, field: statusField, value: verdict })

      const rollback = optimisticFeedResolve(client, projectId, feedItemId, statusField, verdict, itemType)

      mutate({ variables: { feedItemId, verdict, ...extraVars } }).catch(err => {
        log("mutation.error", { mutation: itemType === "permission" ? "resolvePermission" : "resolvePlan", feedItemId, error: err.message })
        rollback()
      })
    },
    [client, mutate, projectId, statusField, itemType],
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
