import { ATTENTION_PRIORITY } from "@/lib/config"
import type { AttentionLevel, TeamFeedItem, PendingItem } from "@/lib/types"

/* ================================================================== */
/*  ATTENTION DERIVATION                                               */
/*                                                                     */
/*  Pure functions that compute attention state from feed data.         */
/*  No side effects, no store dependencies — just data → data.         */
/* ================================================================== */

/** Highest intervention level across a set of agents for global attention UI. */
export function getHighestAttention(agents: { attentionLevel: AttentionLevel }[]): AttentionLevel {
  let highest: AttentionLevel = "none"
  for (const a of agents) {
    if (a.attentionLevel === "permission") return "permission" // early exit at max
    if (ATTENTION_PRIORITY[a.attentionLevel] > ATTENTION_PRIORITY[highest]) {
      highest = a.attentionLevel
    }
  }
  return highest
}

/** Pending permission/plan items for a specific agent */
export function getPendingItemsForAgent(feedItems: TeamFeedItem[], agentName: string): PendingItem[] {
  return feedItems.filter((item): item is PendingItem =>
    (item.type === "permission" && item.agent === agentName && item.permStatus === "pending") ||
    (item.type === "plan" && item.agent === agentName && item.planStatus === "pending"),
  )
}

/** All pending items across all agents */
export function getAllPendingItems(feedItems: TeamFeedItem[]): PendingItem[] {
  return feedItems.filter((item): item is PendingItem =>
    (item.type === "permission" && item.permStatus === "pending") ||
    (item.type === "plan" && item.planStatus === "pending"),
  )
}

/** Derive intervention attention from feed items for a specific agent. */
export function deriveAttentionFromFeed(feedItems: TeamFeedItem[], agentName: string): AttentionLevel {
  const pending = getPendingItemsForAgent(feedItems, agentName)
  let highest: AttentionLevel = "none"
  for (const item of pending) {
    const level: AttentionLevel = item.type === "permission" ? "permission" : "plan"
    if (ATTENTION_PRIORITY[level] > ATTENTION_PRIORITY[highest]) highest = level
  }
  return highest
}

/** Get the agent name from a feed item (if it has one) */
export function getFeedItemAgent(item: TeamFeedItem): string | null {
  switch (item.type) {
    case "summary":
    case "status":
    case "error":
    case "question":
    case "plan":
    case "permission":
    case "multi-question":
    case "task":
      return item.agent
    case "agent-message":
      return item.from
    case "user":
      return item.target ?? null
    case "system":
      return null
  }
}
