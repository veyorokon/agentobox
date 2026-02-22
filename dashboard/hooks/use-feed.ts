"use client"

import { useQuery, useSubscription } from "@apollo/client"
import { useCallback } from "react"
import { AGENT_FEED_QUERY, PROJECT_FEED_QUERY } from "@/lib/graphql/queries"
import { EVENT_STREAM_SUBSCRIPTION } from "@/lib/graphql/subscriptions"
import { TIMELINE_FIELDS } from "@/lib/graphql/fragments"
import type { TimelineEntry } from "@/types"

/**
 * Unified feed hook. Pass agentId for a single agent's feed,
 * or projectId for the merged project feed.
 * agentId takes precedence when both are provided.
 *
 * Uses cursor-based pagination (first/after) with relay-style connections.
 * relayStylePagination in the Apollo cache handles edge merging automatically.
 *
 * Feed queries and subscription now both return TimelineEntryType — no conversion needed.
 */
export function useFeed(opts: {
  projectId?: string
  agentId?: string
  first?: number
}) {
  const first = opts.first ?? 50
  const isAgentFeed = !!opts.agentId
  const feedKey = isAgentFeed ? "agentFeed" : "projectFeed"

  // Both hooks called unconditionally (rules of hooks).
  // Only one actually fires; the other is skipped.
  const agentResult = useQuery(AGENT_FEED_QUERY, {
    variables: { agentId: opts.agentId ?? "", first },
    skip: !opts.agentId,
    pollInterval: 0,
  })

  const projectResult = useQuery(PROJECT_FEED_QUERY, {
    variables: { projectId: opts.projectId ?? "", first },
    skip: !!opts.agentId || !opts.projectId,
    pollInterval: 0,
  })

  const result = isAgentFeed ? agentResult : projectResult

  // Extract flat items from connection edges.
  // Query returns newest-first; reverse for display (oldest at top, newest at bottom).
  const connection = result.data?.[feedKey]
  const items: TimelineEntry[] = (
    connection?.edges?.map((e: { node: TimelineEntry }) => e.node) ?? []
  ).toReversed()
  const pageInfo = connection?.pageInfo ?? {
    hasNextPage: false,
    endCursor: null,
  }

  // Subscribe to real-time timeline updates and merge into feed cache
  useSubscription(EVENT_STREAM_SUBSCRIPTION, {
    variables: { projectId: opts.projectId ?? "" },
    skip: !opts.projectId,
    onError: (error) => {
      console.error("[Feed] subscription error:", error)
    },
    onData: ({ client, data: subData }) => {
      const entry: TimelineEntry | undefined =
        subData.data?.eventStream
      if (!entry) return

      if (process.env.NEXT_PUBLIC_GQL_DEBUG === "1") {
        let blockTypes = "none"
        const msg = (entry.data as Record<string, unknown>)?.message as Record<string, unknown> | undefined
        if (msg) {
          const content = msg.content
          blockTypes = Array.isArray(content)
            ? (content as Array<Record<string, unknown>>).map((b) => b.type).join(",")
            : typeof content === "string" ? "text" : "none"
        }
        console.debug(
          `[Feed] sub event: type=${entry.entryType} agent=${entry.agentName} blocks=[${blockTypes}]`
        )
      }

      // If viewing an agent feed, only include entries for that agent
      if (isAgentFeed && entry.agentId !== opts.agentId) return

      const timelineNode = {
        __typename: "TimelineEntryType",
        ...entry,
      }

      // Write the new item into the normalized cache so it can be referenced
      client.cache.writeFragment({
        fragment: TIMELINE_FIELDS,
        data: timelineNode,
      })

      // Prepend new edge to the connection (cache is newest-first; display reverses).
      // relayStylePagination stores edges as a flat array under the field;
      // cache.modify lets us push without a full updateQuery rewrite.
      client.cache.modify({
        fields: {
          [feedKey](existing: any, { readField, toReference }: any) {
            // Check for duplicate
            const existingEdges = existing?.edges ?? []
            const alreadyExists = existingEdges.some(
              (edge: any) => readField("id", edge.node) === entry.id,
            )
            if (alreadyExists) return existing

            const newEdge = {
              __typename: "TimelineEntryTypeEdge",
              cursor: "",
              node: toReference({
                __typename: "TimelineEntryType",
                id: entry.id,
              }),
            }

            return {
              ...existing,
              edges: [newEdge, ...existingEdges],
            }
          },
        },
      })
    },
  })

  const loadMore = useCallback(() => {
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) return

    return result.fetchMore({
      variables: { after: pageInfo.endCursor },
    })
  }, [result.fetchMore, pageInfo.hasNextPage, pageInfo.endCursor])

  return {
    items,
    loading: result.loading,
    error: result.error,
    hasNextPage: pageInfo.hasNextPage as boolean,
    loadMore,
    refetch: result.refetch,
  }
}
