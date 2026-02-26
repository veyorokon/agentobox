import { create } from "zustand"
import type { RecipientEntry } from "@/lib/types"

/* ================================================================== */
/*  TEAM STORE                                                         */
/*                                                                     */
/*  Permanent home for composer input state (recipients).              */
/*  Agents and feed items live in Apollo cache.                        */
/*                                                                     */
/*  See:                                                               */
/*  - lib/graphql/hooks/use-agents.ts (agent queries + mutations)     */
/*  - lib/graphql/hooks/use-feed.ts   (feed queries + mutations)      */
/* ================================================================== */

interface TeamState {
  recipients: RecipientEntry[]
}

interface TeamActions {
  addRecipient: (entry: RecipientEntry) => void
  removeRecipient: (index: number) => void
  setRecipients: (entries: RecipientEntry[]) => void
  reviewAgent: (agentName: string) => void
}

const DEFAULT_RECIPIENT: RecipientEntry = { type: "agent", value: "team-lead" }

export const useTeamStore = create<TeamState & TeamActions>()((set) => ({
  recipients: [DEFAULT_RECIPIENT],

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
