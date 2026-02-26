import { create } from "zustand"
import type { FakeAgent, TeamFeedItem, RecipientEntry, AttentionLevel, LifecycleStatus } from "@/lib/types"
import { INITIAL_AGENTS, TEAM_FEED } from "@/lib/data/mock"
import { deriveAttentionFromFeed } from "@/lib/attention"

/* ================================================================== */
/*  TEAM STORE                                                         */
/*                                                                     */
/*  Owns all team/session data: agents, feed, recipients.              */
/*  Components subscribe to slices for minimal re-renders.             */
/*                                                                     */
/*  Attention is DERIVED from feed state — resolving a permission or   */
/*  plan item recomputes the agent's attention level automatically.    */
/*                                                                     */
/*  ┌─────────────────────────────────────────────────────────────────┐ */
/*  │  STORE vs EPHEMERAL — when does state belong here?             │ */
/*  │                                                                │ */
/*  │  IN STORE (here):                                              │ */
/*  │  • Domain data (agents, feed items, recipients)                │ */
/*  │  • Settings that persist on the entity (agent mode, model)     │ */
/*  │  • State that other components derive from (feed → attention)  │ */
/*  │                                                                │ */
/*  │  EPHEMERAL (local useState):                                   │ */
/*  │  • Textarea content before send                                │ */
/*  │  • Modal open/closed                                           │ */
/*  │  • Autocomplete suggestion list                                │ */
/*  └─────────────────────────────────────────────────────────────────┘ */
/* ================================================================== */

interface TeamState {
  agents: FakeAgent[]
  feedItems: TeamFeedItem[]
  recipients: RecipientEntry[]
}

interface TeamActions {
  // Agent mutations
  setAgentLifecycle: (agentId: string, status: LifecycleStatus) => void
  setAgentAttention: (agentId: string, level: AttentionLevel) => void
  setAgentMode: (agentId: string, mode: FakeAgent["mode"]) => void
  acknowledgeAgent: (agentId: string) => void

  // Feed mutations (resolve pending items → recompute attention)
  resolvePermission: (feedIndex: number, verdict: "allowed" | "denied") => void
  resolvePlan: (feedIndex: number, verdict: "approved" | "rejected") => void

  // Recipient mutations
  addRecipient: (entry: RecipientEntry) => void
  removeRecipient: (index: number) => void
  setRecipients: (entries: RecipientEntry[]) => void

  // Compound actions
  reviewAgent: (agentName: string) => void
}

const DEFAULT_RECIPIENT: RecipientEntry = { type: "agent", value: "team-lead" }

export const useTeamStore = create<TeamState & TeamActions>()((set, get) => ({
  agents: INITIAL_AGENTS,
  feedItems: TEAM_FEED,
  recipients: [DEFAULT_RECIPIENT],

  // ── Agent mutations ──────────────────────────────────────────────

  setAgentLifecycle: (agentId, status) =>
    set(s => ({
      agents: s.agents.map(a => a.id === agentId ? { ...a, lifecycleStatus: status } : a),
    })),

  setAgentAttention: (agentId, level) =>
    set(s => ({
      agents: s.agents.map(a => a.id === agentId ? { ...a, attentionLevel: level } : a),
    })),

  setAgentMode: (agentId, mode) =>
    set(s => ({
      agents: s.agents.map(a => a.id === agentId ? { ...a, mode } : a),
    })),

  acknowledgeAgent: (agentId) =>
    set(s => ({
      agents: s.agents.map(a =>
        a.id === agentId && a.attentionLevel === "review"
          ? { ...a, attentionLevel: "none" }
          : a,
      ),
    })),

  // ── Feed mutations ───────────────────────────────────────────────

  resolvePermission: (feedIndex, verdict) =>
    set(s => {
      const next = [...s.feedItems]
      const item = next[feedIndex]
      if (item.type !== "permission") return s

      next[feedIndex] = { ...item, permStatus: verdict }
      const agentName = item.agent
      const newAttention = deriveAttentionFromFeed(next, agentName)
      const agent = s.agents.find(a => a.name === agentName)

      return {
        feedItems: next,
        agents: agent
          ? s.agents.map(a => a.id === agent.id ? { ...a, attentionLevel: newAttention } : a)
          : s.agents,
      }
    }),

  resolvePlan: (feedIndex, verdict) =>
    set(s => {
      const next = [...s.feedItems]
      const item = next[feedIndex]
      if (item.type !== "plan") return s

      next[feedIndex] = { ...item, planStatus: verdict }
      const agentName = item.agent
      const newAttention = deriveAttentionFromFeed(next, agentName)
      const agent = s.agents.find(a => a.name === agentName)

      return {
        feedItems: next,
        agents: agent
          ? s.agents.map(a => a.id === agent.id ? { ...a, attentionLevel: newAttention } : a)
          : s.agents,
      }
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
