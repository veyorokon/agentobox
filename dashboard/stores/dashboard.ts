import { create } from 'zustand';

export type RightTab = 'timeline' | 'files' | 'screen';

interface DashboardStore {
  selectedAgentId: string | null;
  scrollToFeedId: string | null;
  rightTab: RightTab;
  expandText: boolean;
  expandImages: boolean;
  deployDialogOpen: boolean;
  secretsDialogOpen: boolean;

  setSelectedAgent: (id: string | null) => void;
  setScrollToFeedId: (id: string | null) => void;
  setRightTab: (tab: RightTab) => void;
  toggleExpandText: () => void;
  toggleExpandImages: () => void;
  setDeployDialogOpen: (open: boolean) => void;
  setSecretsDialogOpen: (open: boolean) => void;
}

export const useDashboardStore = create<DashboardStore>()((set) => ({
  selectedAgentId: null,
  scrollToFeedId: null,
  rightTab: 'timeline',
  expandText: false,
  expandImages: true,
  deployDialogOpen: false,
  secretsDialogOpen: false,

  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  setScrollToFeedId: (id) => set({ scrollToFeedId: id }),
  setRightTab: (tab) => set({ rightTab: tab }),
  toggleExpandText: () => set((s) => ({ expandText: !s.expandText })),
  toggleExpandImages: () => set((s) => ({ expandImages: !s.expandImages })),
  setDeployDialogOpen: (open) => set({ deployDialogOpen: open }),
  setSecretsDialogOpen: (open) => set({ secretsDialogOpen: open }),
}));
