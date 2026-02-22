"use client"

import { useQuery, useSubscription } from "@apollo/client"
import { useMemo } from "react"
import { AGENT_FEED_QUERY, PROJECT_FEED_QUERY } from "@/lib/graphql/queries"
import { EVENT_STREAM_SUBSCRIPTION } from "@/lib/graphql/subscriptions"
import type { TimelineEntry } from "@/types"

/**
 * Unified feed hook. Pass agentId for a single agent's feed,
 * or projectId for the merged project feed.
 * agentId takes precedence when both are provided.
 *
 * Queries return a flat list of TimelineEntryType (no pagination).
 * Results are newest-first from the backend; reversed for display.
 */
export function useFeed(opts: {
  projectId?: string
  agentId?: string
}) {
  const isAgentFeed = !!opts.agentId
  const feedKey = isAgentFeed ? "agentFeed" : "projectFeed"

  const agentResult = useQuery(AGENT_FEED_QUERY, {
    variables: { agentId: opts.agentId ?? "" },
    skip: !opts.agentId,
  })

  const projectResult = useQuery(PROJECT_FEED_QUERY, {
    variables: { projectId: opts.projectId ?? "" },
    skip: !!opts.agentId || !opts.projectId,
  })

  const result = isAgentFeed ? agentResult : projectResult

  const rawItems = result.data?.[feedKey]
  const items: TimelineEntry[] = useMemo(
    () => (rawItems ?? []).toReversed(),
    [rawItems],
  )

  useSubscription(EVENT_STREAM_SUBSCRIPTION, {
    variables: { projectId: opts.projectId ?? "" },
    skip: !opts.projectId,
    onError: (error) => {
      console.error("[Feed] subscription error:", error)
    },
    onData: ({ client, data: subData }) => {
      const entry: TimelineEntry | undefined = subData.data?.eventStream
      if (!entry) return
      if (isAgentFeed && entry.agentId !== opts.agentId) return
      if (entry.entryType === "stream_event") return

      const query = isAgentFeed ? AGENT_FEED_QUERY : PROJECT_FEED_QUERY
      const variables = isAgentFeed
        ? { agentId: opts.agentId }
        : { projectId: opts.projectId }

      const cached = client.cache.readQuery<Record<string, TimelineEntry[]>>({
        query,
        variables,
      })

      const existing = cached?.[feedKey] ?? []
      const alreadyExists = existing.some((e: any) => e.id === entry.id)
      if (alreadyExists) return

      client.cache.writeQuery({
        query,
        variables,
        data: {
          [feedKey]: [
            { __typename: "TimelineEntryType", ...entry },
            ...existing,
          ],
        },
      })
    },
  })

  return {
    items,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
  }
}
