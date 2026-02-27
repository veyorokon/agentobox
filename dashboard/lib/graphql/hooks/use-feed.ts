import { useQuery, useSubscription, useMutation, useApolloClient } from "@apollo/client"
import { useCallback } from "react"
import { GET_FEED } from "@/lib/graphql/queries/feed"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { ON_FEED_ITEM_CHANGED } from "@/lib/graphql/subscriptions/feed"
import { RESOLVE_PERMISSION, RESOLVE_PLAN } from "@/lib/graphql/mutations/agents"
import { SEND_MESSAGE } from "@/lib/graphql/mutations/feed"
import { deriveAttentionFromFeed } from "@/lib/attention"
import { IS_MOCK } from "@/lib/graphql/client"
import { createLogger } from "@/lib/logger"
import type { Agent, TeamFeedItem, RecipientEntry } from "@/lib/types"

/* ================================================================== */
/*  FEED HOOKS                                                          */
/*                                                                      */
/*  Mock mode: cache-only, no network.                                  */
/*  Real mode: cache-and-network + subscription for live updates.       */
/* ================================================================== */

const log = createLogger("apollo")

type FeedData = { feed: TeamFeedItem[] }

export function useFeed(projectId?: string) {
  const client = useApolloClient()

  const result = useQuery<FeedData>(GET_FEED, {
    fetchPolicy: IS_MOCK ? "cache-only" : "cache-and-network",
  })

  // Real-time feed updates via subscription
  useSubscription(ON_FEED_ITEM_CHANGED, {
    variables: { projectId: projectId ?? "" },
    skip: IS_MOCK || !projectId,
    onData: ({ data: subData }) => {
      const item = subData.data?.feedItemChanged
      if (!item) return
      log("subscription.feed_item_changed", { id: item.id, type: item.type })

      // Upsert into feed cache
      const existing = client.readQuery<FeedData>({ query: GET_FEED })
      const feed = existing?.feed ?? []
      const idx = feed.findIndex(f => f.id === item.id)

      if (idx >= 0) {
        // Update existing item
        const updated = [...feed]
        updated[idx] = item
        client.writeQuery({ query: GET_FEED, data: { feed: updated } })
      } else {
        // Append new item
        client.writeQuery({ query: GET_FEED, data: { feed: [...feed, item] } })
      }
    },
  })

  return result
}

export function useResolvePermission() {
  const client = useApolloClient()
  const [mutate] = useMutation(RESOLVE_PERMISSION)

  return useCallback(
    (feedItemId: string, verdict: "allowed" | "denied") => {
      log("cache.modify", { typename: "FeedItem", id: feedItemId, field: "permStatus", value: verdict })

      // 1. Optimistic cache update on the FeedItem
      client.cache.modify({
        id: client.cache.identify({ __typename: "FeedItem", id: feedItemId }),
        fields: {
          permStatus: () => verdict,
        },
      })

      // 2. Derive and update agent attention
      const feedData = client.readQuery<FeedData>({ query: GET_FEED })
      const feed = feedData?.feed ?? []
      const item = feed.find(fi => fi.id === feedItemId)
      if (item && item.type === "permission") {
        const agentName = item.agent
        const newAttention = deriveAttentionFromFeed(feed, agentName)
        log("cache.modify", { typename: "Agent", agent: agentName, field: "attentionLevel", value: newAttention, reason: "permission resolved" })

        const agentsData = client.readQuery<{ agents: Agent[] }>({ query: GET_AGENTS })
        const agent = agentsData?.agents.find(a => a.name === agentName)
        if (agent) {
          client.cache.modify({
            id: client.cache.identify({ __typename: "Agent", id: agent.id }),
            fields: { attentionLevel: () => newAttention },
          })
        }
      }

      // 3. Fire mutation to backend
      if (!IS_MOCK) {
        mutate({ variables: { feedItemId, verdict } })
      }
    },
    [client, mutate],
  )
}

export function useResolvePlan() {
  const client = useApolloClient()
  const [mutate] = useMutation(RESOLVE_PLAN)

  return useCallback(
    (feedItemId: string, verdict: "approved" | "rejected") => {
      log("cache.modify", { typename: "FeedItem", id: feedItemId, field: "planStatus", value: verdict })

      // 1. Optimistic cache update on the FeedItem
      client.cache.modify({
        id: client.cache.identify({ __typename: "FeedItem", id: feedItemId }),
        fields: {
          planStatus: () => verdict,
        },
      })

      // 2. Derive and update agent attention
      const feedData = client.readQuery<FeedData>({ query: GET_FEED })
      const feed = feedData?.feed ?? []
      const item = feed.find(fi => fi.id === feedItemId)
      if (item && item.type === "plan") {
        const agentName = item.agent
        const newAttention = deriveAttentionFromFeed(feed, agentName)
        log("cache.modify", { typename: "Agent", agent: agentName, field: "attentionLevel", value: newAttention, reason: "plan resolved" })

        const agentsData = client.readQuery<{ agents: Agent[] }>({ query: GET_AGENTS })
        const agent = agentsData?.agents.find(a => a.name === agentName)
        if (agent) {
          client.cache.modify({
            id: client.cache.identify({ __typename: "Agent", id: agent.id }),
            fields: { attentionLevel: () => newAttention },
          })
        }
      }

      // 3. Fire mutation to backend
      if (!IS_MOCK) {
        mutate({ variables: { feedItemId, verdict } })
      }
    },
    [client, mutate],
  )
}

export function useSendMessage() {
  const [mutate] = useMutation(SEND_MESSAGE)

  return useCallback(
    (projectId: string, text: string, recipients: RecipientEntry[]) => {
      if (IS_MOCK) {
        log("mock.sendMessage", { projectId, text, recipients })
        return
      }

      const recipientInputs = recipients.map(r => {
        if (r.type === "all") return { type: "all", value: "" }
        return { type: r.type, value: r.value }
      })

      mutate({ variables: { projectId, text, recipients: recipientInputs } })
    },
    [mutate],
  )
}
