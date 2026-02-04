import { create } from 'zustand';
import type { Agent, AgentStatus } from '@/types';

interface AgentStore {
  agents: Record<string, Agent[]>; // bentoId -> agents
  getAgentsForBento: (bentoId: string) => Agent[];
  getAgent: (bentoId: string, name: string) => Agent | undefined;
  setAgents: (bentoId: string, agents: Agent[]) => void;
  updateAgent: (bentoId: string, name: string, updates: Partial<Agent>) => void;
  createAgent: (bentoId: string, name: string) => void;
  killAgent: (bentoId: string, name: string) => void;
}

export const useAgentStore = create<AgentStore>()((set, get) => ({
  agents: {},

  getAgentsForBento: (bentoId) => get().agents[bentoId] || [],

  getAgent: (bentoId, name) =>
    get().agents[bentoId]?.find((a) => a.name === name),

  setAgents: (bentoId, agents) =>
    set((state) => ({
      agents: { ...state.agents, [bentoId]: agents },
    })),

  updateAgent: (bentoId, name, updates) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [bentoId]: (state.agents[bentoId] || []).map((a) =>
          a.name === name ? { ...a, ...updates, lastActivity: new Date().toISOString() } : a
        ),
      },
    })),

  createAgent: (bentoId, name) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [bentoId]: [
          ...(state.agents[bentoId] || []),
          {
            name,
            status: 'idle' as AgentStatus,
            task: '',
            message: 'Ready for tasks',
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
          },
        ],
      },
    })),

  killAgent: (bentoId, name) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [bentoId]: (state.agents[bentoId] || []).map((a) =>
          a.name === name ? { ...a, status: 'dead' as AgentStatus, message: 'Killed by user' } : a
        ),
      },
    })),
}));
