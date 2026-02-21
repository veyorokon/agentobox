import { create } from "zustand"

interface UIState {
  sidebarOpen: boolean
  selectedProjectId: string | null
  selectedAgentId: string | null
  activeRightPanel: "agents" | "timeline" | "files" | "screen"
  composerHeight: number

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  selectProject: (id: string) => void
  selectAgent: (id: string | null) => void
  setRightPanel: (panel: UIState["activeRightPanel"]) => void
  setComposerHeight: (height: number) => void
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  selectedProjectId: null,
  selectedAgentId: null,
  activeRightPanel: "agents",
  composerHeight: 44,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  selectProject: (id) => set({ selectedProjectId: id, selectedAgentId: null }),
  selectAgent: (id) => set({ selectedAgentId: id }),
  setRightPanel: (panel) => set({ activeRightPanel: panel }),
  setComposerHeight: (height) => set({ composerHeight: height }),
}))
