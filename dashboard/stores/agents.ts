import { create } from 'zustand';
import type { Agent } from '@/types';

export type DetailTab = 'desktop' | 'chat' | 'config';

interface AgentsState {
  agents: Record<string, Agent[]>; // keyed by projectId
  selectedAgentId: string | null;
  detailTab: DetailTab;
  setAgents: (projectId: string, agents: Agent[]) => void;
  upsertAgent: (projectId: string, agent: Agent) => void;
  setSelectedAgent: (agentId: string | null) => void;
  setDetailTab: (tab: DetailTab) => void;
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: {},
  selectedAgentId: null,
  detailTab: 'desktop',

  setAgents: (projectId, agents) =>
    set((state) => ({
      agents: { ...state.agents, [projectId]: agents },
    })),

  upsertAgent: (projectId, agent) =>
    set((state) => {
      const current = state.agents[projectId] ?? [];
      const idx = current.findIndex((a) => a.id === agent.id);
      const updated =
        idx >= 0
          ? current.map((a, i) => (i === idx ? agent : a))
          : [...current, agent];
      return { agents: { ...state.agents, [projectId]: updated } };
    }),

  setSelectedAgent: (agentId) =>
    set({ selectedAgentId: agentId }),

  setDetailTab: (tab) =>
    set({ detailTab: tab }),
}));
