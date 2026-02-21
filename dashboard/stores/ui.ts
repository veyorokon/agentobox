import { create } from "zustand"

export interface Toast {
  id: string
  message: string
  type: "success" | "error" | "info"
  duration?: number
}

interface UIState {
  sidebarOpen: boolean
  selectedProjectId: string | null
  selectedAgentId: string | null
  activeRightPanel: "agents" | "timeline" | "files" | "screen"
  composerHeight: number
  toasts: Toast[]

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  selectProject: (id: string) => void
  selectAgent: (id: string | null) => void
  setRightPanel: (panel: UIState["activeRightPanel"]) => void
  setComposerHeight: (height: number) => void
  addToast: (toast: Omit<Toast, "id">) => void
  removeToast: (id: string) => void
}

let toastCounter = 0

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  selectedProjectId: null,
  selectedAgentId: null,
  activeRightPanel: "agents",
  composerHeight: 44,
  toasts: [],

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  selectProject: (id) => set({ selectedProjectId: id, selectedAgentId: null }),
  selectAgent: (id) => set({ selectedAgentId: id }),
  setRightPanel: (panel) => set({ activeRightPanel: panel }),
  setComposerHeight: (height) => set({ composerHeight: height }),
  addToast: (toast) => {
    const id = `toast-${++toastCounter}-${Date.now()}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
