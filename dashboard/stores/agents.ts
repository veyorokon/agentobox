import { create } from 'zustand';
import type { Agent, AgentStatus } from '@/types';

interface AgentStore {
  agents: Record<string, Agent[]>; // projectId -> agents
  getAgentsForProject: (projectId: string) => Agent[];
  getAgent: (projectId: string, name: string) => Agent | undefined;
  setAgents: (projectId: string, agents: Agent[]) => void;
  updateAgent: (projectId: string, name: string, updates: Partial<Agent>) => void;
  createAgent: (projectId: string, name: string, task?: string) => void;
  killAgent: (projectId: string, name: string) => void;
}

export const useAgentStore = create<AgentStore>()((set, get) => ({
  agents: {},

  getAgentsForProject: (projectId) => get().agents[projectId] || [],

  getAgent: (projectId, name) =>
    get().agents[projectId]?.find((a) => a.name === name),

  setAgents: (projectId, agents) =>
    set((state) => ({
      agents: { ...state.agents, [projectId]: agents },
    })),

  updateAgent: (projectId, name, updates) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [projectId]: (state.agents[projectId] || []).map((a) =>
          a.name === name ? { ...a, ...updates, lastActivity: new Date().toISOString() } : a
        ),
      },
    })),

  createAgent: (projectId, name, task) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [projectId]: [
          ...(state.agents[projectId] || []),
          {
            name,
            status: 'deploying' as AgentStatus,
            task: task || '',
            message: 'Spinning up container...',
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
          },
        ],
      },
    })),

  killAgent: (projectId, name) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [projectId]: (state.agents[projectId] || []).map((a) =>
          a.name === name ? { ...a, status: 'dead' as AgentStatus, message: 'Killed by user' } : a
        ),
      },
    })),
}));
