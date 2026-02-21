"use client"

import { useQuery, useSubscription } from "@apollo/client"
import { useCallback, useRef } from "react"
import { AGENT_FEED_QUERY, PROJECT_FEED_QUERY } from "@/lib/graphql/queries"
import { TIMELINE_STREAM_SUBSCRIPTION } from "@/lib/graphql/subscriptions"
import { FEED_ITEM_FIELDS } from "@/lib/graphql/fragments"
import type { FeedItem, TimelineEntry } from "@/types"

/**
 * Map a TimelineEntry from the subscription into a partial FeedItem
 * that Apollo can normalize into the feed cache.
 *
 * TimelineEntry has: id, entryType, agentId, agentName, summary, data, createdAt
 * FeedItem has: id, kind, agentId, agentName, timestamp, text, ...nullable fields
 *
 * We pull known fields from `data` when present and fall back to summary for text.
 */
function timelineToFeedItem(entry: TimelineEntry): FeedItem {
  const d = entry.data ?? {}
  return {
    __typename: "FeedItemType",
    id: entry.id,
    kind: (d.kind as string) ?? entry.entryType ?? "SYSTEM",
    agentId: entry.agentId,
    agentName: entry.agentName,
    timestamp: entry.createdAt,
    text: (d.text as string) ?? entry.summary ?? null,
    imageUrls: (d.imageUrls as string[]) ?? null,
    targetName: (d.targetName as string) ?? null,
    tools: (d.tools as FeedItem["tools"]) ?? null,
    fromStatus: (d.fromStatus as string) ?? null,
    toStatus: (d.toStatus as string) ?? null,
    taskSummary: (d.taskSummary as string) ?? null,
    errorText: (d.errorText as string) ?? null,
    cumulativeCostUsd: (d.cumulativeCostUsd as number) ?? null,
    questions: (d.questions as FeedItem["questions"]) ?? null,
    memoryContent: (d.memoryContent as string) ?? null,
    planStatus: (d.planStatus as string) ?? null,
    planSummary: (d.planSummary as string) ?? null,
    planSteps: (d.planSteps as string[]) ?? null,
    taskDividerSubject: (d.taskDividerSubject as string) ?? null,
    taskDividerId: (d.taskDividerId as string) ?? null,
    taskDividerActiveForm: (d.taskDividerActiveForm as string) ?? null,
    answers: (d.answers as FeedItem["answers"]) ?? null,
    toolUseId: (d.toolUseId as string) ?? null,
    senderName: (d.senderName as string) ?? null,
    targetAgentIds: (d.targetAgentIds as string[]) ?? null,
  } as FeedItem & { __typename: string }
}

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
  const feedKey = isAgentFeed ? "agentFeed" : "projectFeed"

  // Ref for stable offset in loadMore — avoids stale closure over items.length
  const offsetRef = useRef(0)

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
  const items: FeedItem[] = result.data?.[feedKey] ?? []

  // Keep offset ref in sync with current item count
  offsetRef.current = items.length

  // Subscribe to real-time timeline updates and merge into feed cache
  useSubscription(TIMELINE_STREAM_SUBSCRIPTION, {
    variables: { projectId: opts.projectId! },
    skip: !opts.projectId,
    onData: ({ client, data: subData }) => {
      const entry: TimelineEntry | undefined =
        subData.data?.timelineStream
      if (!entry) return

      // If viewing an agent feed, only include entries for that agent
      if (isAgentFeed && entry.agentId !== opts.agentId) return

      const feedItem = timelineToFeedItem(entry)

      // Write the item into the normalized cache
      client.cache.writeFragment({
        fragment: FEED_ITEM_FIELDS,
        data: feedItem,
      })

      // Append to the correct feed query result
      const modifier = (existing: readonly any[] = [], { readField }: any) => {
        // Deduplicate — don't add if already present
        const alreadyExists = existing.some(
          (ref: any) => readField("id", ref) === entry.id
        )
        if (alreadyExists) return existing

        const newRef = client.cache.writeFragment({
          fragment: FEED_ITEM_FIELDS,
          data: feedItem,
        })
        return [...existing, newRef]
      }

      client.cache.modify({
        fields: { [feedKey]: modifier } as any,
      })
    },
  })

  const loadMore = useCallback(() => {
    const vars = isAgentFeed
      ? { agentId: opts.agentId, limit, offset: offsetRef.current }
      : { projectId: opts.projectId, limit, offset: offsetRef.current }

    return result.fetchMore({
      variables: vars as any,
      updateQuery: (prev: any, { fetchMoreResult }: any) => {
        if (!fetchMoreResult) return prev
        const prevItems: any[] = prev[feedKey] ?? []
        const newItems: any[] = fetchMoreResult[feedKey] ?? []

        // Deduplicate by ID
        const existingIds = new Set(prevItems.map((i: any) => i.id))
        const uniqueNew = newItems.filter((i: any) => !existingIds.has(i.id))

        return {
          [feedKey]: [...prevItems, ...uniqueNew],
        }
      },
    })
  }, [result.fetchMore, isAgentFeed, opts.agentId, opts.projectId, limit, feedKey])

  return {
    items,
    loading: result.loading,
    error: result.error,
    loadMore,
    refetch: result.refetch,
  }
}
