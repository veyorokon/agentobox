"use client"

import { useQuery } from "@apollo/client"
import { useCallback } from "react"
import { AGENT_FEED_QUERY, PROJECT_FEED_QUERY } from "@/lib/graphql/queries"
import type { FeedItem } from "@/types"

/**
 * Unified feed hook. Pass agentId for a single agent's feed,
 * or projectId for the merged project feed.
 * agentId takes precedence when both are provided.
 */
export function useFeed(opts: {
  projectId?: string
  agentId?: string
  limit?: number
}) {
  const limit = opts.limit ?? 200
  const isAgentFeed = !!opts.agentId

  // Both hooks called unconditionally (rules of hooks).
  // Only one actually fires; the other is skipped.
  const agentResult = useQuery(AGENT_FEED_QUERY, {
    variables: { agentId: opts.agentId ?? "", limit, offset: 0 },
    skip: !opts.agentId,
    pollInterval: 0,
  })

  const projectResult = useQuery(PROJECT_FEED_QUERY, {
    variables: { projectId: opts.projectId ?? "", limit, offset: 0 },
    skip: !!opts.agentId || !opts.projectId,
    pollInterval: 0,
  })

  const result = isAgentFeed ? agentResult : projectResult
  const feedKey = isAgentFeed ? "agentFeed" : "projectFeed"
  const items: FeedItem[] = result.data?.[feedKey] ?? []

  const loadMore = useCallback(() => {
    const vars = isAgentFeed
      ? { agentId: opts.agentId, limit, offset: items.length }
      : { projectId: opts.projectId, limit, offset: items.length }

    return result.fetchMore({
      variables: vars as any,
      updateQuery: (prev: any, { fetchMoreResult }: any) => {
        if (!fetchMoreResult) return prev
        return {
          [feedKey]: [
            ...(prev[feedKey] ?? []),
            ...fetchMoreResult[feedKey],
          ],
        }
      },
    })
  }, [result.fetchMore, isAgentFeed, opts.agentId, opts.projectId, limit, items.length, feedKey])

  return {
    items,
    loading: result.loading,
    error: result.error,
    loadMore,
    refetch: result.refetch,
  }
}
