import { create } from "zustand"
import type { TeamFeedItem, RecipientEntry } from "@/lib/types"
import { TEAM_FEED } from "@/lib/data/mock"

/* ================================================================== */
/*  TEAM STORE                                                         */
/*                                                                     */
/*  Owns feed items (until Part 2b migration) and recipients.          */
/*  Agents moved to Apollo cache — see lib/graphql/hooks/use-agents.   */
/*                                                                     */
/*  Attention derivation for feed mutations (resolvePermission,        */
/*  resolvePlan) uses Apollo cache.modify to update agent attention    */
/*  — see the resolve* actions below.                                  */
/*                                                                     */
/*  ┌─────────────────────────────────────────────────────────────────┐ */
/*  │  STORE vs APOLLO — ownership split                              │ */
/*  │                                                                │ */
/*  │  APOLLO CACHE:                                                 │ */
/*  │  • agents (query + cache.modify for mutations)                 │ */
/*  │                                                                │ */
/*  │  THIS STORE:                                                   │ */
/*  │  • feedItems (moves to Apollo in Part 2b)                      │ */
/*  │  • recipients (stays permanently — composer input state)       │ */
/*  └─────────────────────────────────────────────────────────────────┘ */
/* ================================================================== */

interface TeamState {
  feedItems: TeamFeedItem[]
  recipients: RecipientEntry[]
}

interface TeamActions {
  // Feed mutations (moves to Apollo in Part 2b)
  resolvePermission: (feedItemId: string, verdict: "allowed" | "denied") => void
  resolvePlan: (feedItemId: string, verdict: "approved" | "rejected") => void

  // Recipient mutations (stays permanently)
  addRecipient: (entry: RecipientEntry) => void
  removeRecipient: (index: number) => void
  setRecipients: (entries: RecipientEntry[]) => void
  reviewAgent: (agentName: string) => void
}

const DEFAULT_RECIPIENT: RecipientEntry = { type: "agent", value: "team-lead" }

export const useTeamStore = create<TeamState & TeamActions>()((set) => ({
  feedItems: TEAM_FEED,
  recipients: [DEFAULT_RECIPIENT],

  // ── Feed mutations ───────────────────────────────────────────────
  // NOTE: These no longer recompute agent attention — that's handled
  // by the calling component via Apollo cache.modify after resolving.
  // In production, backend computes attention and pushes via subscription.

  resolvePermission: (feedItemId, verdict) =>
    set(s => {
      const next = [...s.feedItems]
      const idx = next.findIndex(fi => fi.id === feedItemId)
      if (idx < 0) return s
      const item = next[idx]
      if (item.type !== "permission") return s

      next[idx] = { ...item, permStatus: verdict }
      return { feedItems: next }
    }),

  resolvePlan: (feedItemId, verdict) =>
    set(s => {
      const next = [...s.feedItems]
      const idx = next.findIndex(fi => fi.id === feedItemId)
      if (idx < 0) return s
      const item = next[idx]
      if (item.type !== "plan") return s

      next[idx] = { ...item, planStatus: verdict }
      return { feedItems: next }
    }),

  // ── Recipient mutations ──────────────────────────────────────────

  addRecipient: (entry) =>
    set(s => {
      if (entry.type === "all") return { recipients: [entry] }
      const without = s.recipients.filter(r => r.type !== "all")
      const entryKey = `${entry.type}:${"value" in entry ? entry.value : ""}`
      const isDupe = without.some(r => `${r.type}:${"value" in r ? r.value : ""}` === entryKey)
      if (isDupe) return { recipients: without }
      return { recipients: [...without, entry] }
    }),

  removeRecipient: (index) =>
    set(s => {
      const next = s.recipients.filter((_, i) => i !== index)
      return { recipients: next.length === 0 ? [DEFAULT_RECIPIENT] : next }
    }),

  setRecipients: (entries) =>
    set({ recipients: entries.length === 0 ? [DEFAULT_RECIPIENT] : entries }),

  // ── Compound actions ─────────────────────────────────────────────

  reviewAgent: (agentName) =>
    set({ recipients: [{ type: "agent", value: agentName }] }),
}))
