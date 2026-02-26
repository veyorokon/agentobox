import { useQuery, useApolloClient } from "@apollo/client"
import { useCallback } from "react"
import { GET_FEED } from "@/lib/graphql/queries/feed"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { deriveAttentionFromFeed } from "@/lib/attention"
import type { FakeAgent, TeamFeedItem } from "@/lib/types"

/* ================================================================== */
/*  FEED HOOKS                                                          */
/*                                                                      */
/*  Pure Apollo operations over the feed cache.                         */
/*  No zustand dependency — feed + agents both live in Apollo.          */
/*                                                                      */
/*  When switching from mock to real backend, only this file changes.  */
/* ================================================================== */

type FeedData = { feed: TeamFeedItem[] }

export function useFeed() {
  return useQuery<FeedData>(GET_FEED, { fetchPolicy: "cache-only" })
}

export function useResolvePermission() {
  const client = useApolloClient()

  return useCallback(
    (feedItemId: string, verdict: "allowed" | "denied") => {
      // 1. Update the FeedItem in Apollo cache
      client.cache.modify({
        id: client.cache.identify({ __typename: "FeedItem", id: feedItemId }),
        fields: {
          permStatus: () => verdict,
        },
      })

      // 2. Read updated feed + find the affected agent
      const feedData = client.readQuery<FeedData>({ query: GET_FEED })
      const feed = feedData?.feed ?? []
      const item = feed.find(fi => fi.id === feedItemId)
      if (!item || item.type !== "permission") return

      const agentName = item.agent
      const newAttention = deriveAttentionFromFeed(feed, agentName)

      // 3. Update agent attention in Apollo cache
      const agentsData = client.readQuery<{ agents: FakeAgent[] }>({ query: GET_AGENTS })
      const agent = agentsData?.agents.find(a => a.name === agentName)
      if (!agent) return

      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agent.id }),
        fields: { attentionLevel: () => newAttention },
      })
    },
    [client],
  )
}

export function useResolvePlan() {
  const client = useApolloClient()

  return useCallback(
    (feedItemId: string, verdict: "approved" | "rejected") => {
      // 1. Update the FeedItem in Apollo cache
      client.cache.modify({
        id: client.cache.identify({ __typename: "FeedItem", id: feedItemId }),
        fields: {
          planStatus: () => verdict,
        },
      })

      // 2. Read updated feed + find the affected agent
      const feedData = client.readQuery<FeedData>({ query: GET_FEED })
      const feed = feedData?.feed ?? []
      const item = feed.find(fi => fi.id === feedItemId)
      if (!item || item.type !== "plan") return

      const agentName = item.agent
      const newAttention = deriveAttentionFromFeed(feed, agentName)

      // 3. Update agent attention in Apollo cache
      const agentsData = client.readQuery<{ agents: FakeAgent[] }>({ query: GET_AGENTS })
      const agent = agentsData?.agents.find(a => a.name === agentName)
      if (!agent) return

      client.cache.modify({
        id: client.cache.identify({ __typename: "Agent", id: agent.id }),
        fields: { attentionLevel: () => newAttention },
      })
    },
    [client],
  )
}
