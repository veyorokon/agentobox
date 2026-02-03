import { create } from 'zustand';
import type { Bento, Agent } from '@/types';

interface BentoStore {
  bentos: Bento[];
  currentBentoId: string | null;
  setBentos: (bentos: Bento[]) => void;
  setCurrentBento: (id: string | null) => void;
  getBento: (id: string) => Bento | undefined;
  createBento: (name: string) => void;
  deleteBento: (id: string) => void;
}

export const useBentoStore = create<BentoStore>()((set, get) => ({
  bentos: [],
  currentBentoId: null,

  setBentos: (bentos) => set({ bentos }),

  setCurrentBento: (id) => set({ currentBentoId: id }),

  getBento: (id) => get().bentos.find((b) => b.id === id),

  createBento: (name) =>
    set((state) => ({
      bentos: [
        ...state.bentos,
        {
          id: `bento-${Date.now()}`,
          name,
          agents: [],
          agentoOnline: true,
          lastActivity: new Date().toISOString(),
        },
      ],
    })),

  deleteBento: (id) =>
    set((state) => ({
      bentos: state.bentos.filter((b) => b.id !== id),
    })),
}));
