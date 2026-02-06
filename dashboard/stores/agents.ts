import { create } from 'zustand';
import type { Agent } from '@/types';

interface AgentsState {
  agents: Record<string, Agent[]>; // keyed by projectId
  setAgents: (projectId: string, agents: Agent[]) => void;
  upsertAgent: (projectId: string, agent: Agent) => void;
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: {},

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
}));
