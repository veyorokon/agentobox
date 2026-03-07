import { create } from "zustand"
import { zustandLog } from "@/lib/stores/log-middleware"
import type { ViewMode } from "@/lib/types"

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

type SidebarTab = "agents" | "skills" | "tasks"
type MainTab = "chat" | "agents" | "skills" | "tasks"

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
  mutedAgentIds: Set<string> // agents with auto-expand disabled

  /* Search & filter — shared across desktop left-panel and mobile cards panel */
  agentSearch: string
  agentTagFilter: string | null
  skillSearch: string
  skillTagFilter: string | null
  skillsAllExpanded: boolean
  taskSearch: string

  /* Global view mode — broadcast to all expanded cards */
  globalViewMode: ViewMode | null

  /* Attention bar — shared across 3 mobile tab instances */
  attentionStepIdx: number
  attentionExpandedFeedItemId: string | null
}

interface SidebarActions {
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number | null) => void

  setSidebarTab: (tab: SidebarTab) => void
  setMainTab: (tab: MainTab) => void

  toggleAgent: (id: string) => void
  expandAgent: (id: string) => void
  collapseAgent: (id: string) => void
  toggleExpandAll: (allAgentIds: string[]) => void
  setFocusedAgent: (id: string | null) => void
  toggleMuteAgent: (id: string) => void

  setAgentSearch: (query: string) => void
  setAgentTagFilter: (tag: string | null) => void
  setSkillSearch: (query: string) => void
  setSkillTagFilter: (tag: string | null) => void
  toggleSkillsExpandAll: () => void
  setTaskSearch: (query: string) => void

  setGlobalViewMode: (mode: ViewMode | null) => void

  setAttentionStepIdx: (idx: number) => void
  setAttentionExpandedFeedItemId: (id: string | null) => void
}

export const useSidebarStore = create<SidebarState & SidebarActions>()(zustandLog("sidebar", (set) => ({
  sidebarOpen: true, // component overrides on mount based on breakpoint
  sidebarWidth: null,
  sidebarTab: "agents",
  mainTab: "chat",
  expandedAgentIds: new Set(),
  focusedAgentId: null,
  mutedAgentIds: new Set(),
  agentSearch: "",
  agentTagFilter: null,
  skillSearch: "",
  skillTagFilter: null,
  skillsAllExpanded: false,
  taskSearch: "",
  globalViewMode: "terminal" as ViewMode,
  attentionStepIdx: 0,
  attentionExpandedFeedItemId: null,

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

  expandAgent: (id) =>
    set((s) => {
      if (s.expandedAgentIds.has(id)) return {}
      const next = new Set(s.expandedAgentIds)
      next.add(id)
      return { expandedAgentIds: next, focusedAgentId: id }
    }),

  collapseAgent: (id) =>
    set((s) => {
      if (!s.expandedAgentIds.has(id)) return {}
      const next = new Set(s.expandedAgentIds)
      next.delete(id)
      return { expandedAgentIds: next }
    }),

  toggleExpandAll: (allAgentIds) =>
    set((s) => {
      const allOpen = allAgentIds.every((id) => s.expandedAgentIds.has(id))
      return { expandedAgentIds: allOpen ? new Set() : new Set(allAgentIds) }
    }),

  setFocusedAgent: (id) => set({ focusedAgentId: id }),

  toggleMuteAgent: (id) =>
    set((s) => {
      const next = new Set(s.mutedAgentIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { mutedAgentIds: next }
    }),

  setAgentSearch: (query) => set({ agentSearch: query }),
  setAgentTagFilter: (tag) => set({ agentTagFilter: tag }),
  setSkillSearch: (query) => set({ skillSearch: query }),
  setSkillTagFilter: (tag) => set({ skillTagFilter: tag }),
  toggleSkillsExpandAll: () => set((s) => ({ skillsAllExpanded: !s.skillsAllExpanded })),
  setTaskSearch: (query) => set({ taskSearch: query }),

  setGlobalViewMode: (mode) => set({ globalViewMode: mode }),

  setAttentionStepIdx: (idx) => set({ attentionStepIdx: idx }),
  setAttentionExpandedFeedItemId: (id) => set({ attentionExpandedFeedItemId: id }),
})))
