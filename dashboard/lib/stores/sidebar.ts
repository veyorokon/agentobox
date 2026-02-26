import { create } from "zustand"

/* ================================================================== */
/*  SIDEBAR STORE                                                      */
/*                                                                     */
/*  Owns UI state that must survive layout transitions (desktop ↔      */
/*  mobile) or is shared across multiple component instances.          */
/*                                                                     */
/*  ┌─────────────────────────────────────────────────────────────────┐ */
/*  │  STORE vs EPHEMERAL — when does state belong here?             │ */
/*  │                                                                │ */
/*  │  IN STORE (here):                                              │ */
/*  │  • Survives layout/breakpoint transitions                      │ */
/*  │  • Shared across components that render the same concept        │ */
/*  │    at different breakpoints (AgentLeftPanel ↔ AgentCardsPanel)  │ */
/*  │  • Affects what other components display (search → filtered     │ */
/*  │    agent list)                                                  │ */
/*  │                                                                │ */
/*  │  EPHEMERAL (local useState):                                   │ */
/*  │  • Dropdown open/closed, tooltip visible, animation state      │ */
/*  │  • Select mode + selected IDs (bulk action session)            │ */
/*  │  • Form field values before submission                         │ */
/*  │  • Anything that should reset when the component unmounts      │ */
/*  └─────────────────────────────────────────────────────────────────┘ */
/* ================================================================== */

type SidebarTab = "agents" | "skills"
type MainTab = "chat" | "agents" | "skills"

interface SidebarState {
  /* Panel visibility & sizing */
  sidebarOpen: boolean
  sidebarWidth: number | null // null = use breakpoint default

  /* Tab selection */
  sidebarTab: SidebarTab
  mainTab: MainTab // mobile only

  /* Agent card state */
  expandedAgentIds: Set<string>
  focusedAgentId: string | null

  /* Search & filter — shared across desktop left-panel and mobile cards panel */
  agentSearch: string
  agentTagFilter: string | null
  skillSearch: string
  skillTagFilter: string | null
  skillsAllExpanded: boolean

  /* Attention bar — shared across 3 mobile tab instances */
  attentionStepIdx: number
  attentionExpandedFeedIndex: number | null
}

interface SidebarActions {
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number | null) => void

  setSidebarTab: (tab: SidebarTab) => void
  setMainTab: (tab: MainTab) => void

  toggleAgent: (id: string) => void
  toggleExpandAll: (allAgentIds: string[]) => void
  setFocusedAgent: (id: string | null) => void

  setAgentSearch: (query: string) => void
  setAgentTagFilter: (tag: string | null) => void
  setSkillSearch: (query: string) => void
  setSkillTagFilter: (tag: string | null) => void
  toggleSkillsExpandAll: () => void

  setAttentionStepIdx: (idx: number) => void
  setAttentionExpandedFeedIndex: (idx: number | null) => void
}

export const useSidebarStore = create<SidebarState & SidebarActions>()((set) => ({
  sidebarOpen: true, // component overrides on mount based on breakpoint
  sidebarWidth: null,
  sidebarTab: "agents",
  mainTab: "chat",
  expandedAgentIds: new Set(["1"]),
  focusedAgentId: "1",
  agentSearch: "",
  agentTagFilter: null,
  skillSearch: "",
  skillTagFilter: null,
  skillsAllExpanded: false,
  attentionStepIdx: 0,
  attentionExpandedFeedIndex: null,

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setMainTab: (tab) => set({ mainTab: tab }),

  toggleAgent: (id) =>
    set((s) => {
      const next = new Set(s.expandedAgentIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedAgentIds: next, focusedAgentId: id }
    }),

  toggleExpandAll: (allAgentIds) =>
    set((s) => {
      const allOpen = allAgentIds.every((id) => s.expandedAgentIds.has(id))
      return { expandedAgentIds: allOpen ? new Set() : new Set(allAgentIds) }
    }),

  setFocusedAgent: (id) => set({ focusedAgentId: id }),

  setAgentSearch: (query) => set({ agentSearch: query }),
  setAgentTagFilter: (tag) => set({ agentTagFilter: tag }),
  setSkillSearch: (query) => set({ skillSearch: query }),
  setSkillTagFilter: (tag) => set({ skillTagFilter: tag }),
  toggleSkillsExpandAll: () => set((s) => ({ skillsAllExpanded: !s.skillsAllExpanded })),

  setAttentionStepIdx: (idx) => set({ attentionStepIdx: idx }),
  setAttentionExpandedFeedIndex: (idx) => set({ attentionExpandedFeedIndex: idx }),
}))
