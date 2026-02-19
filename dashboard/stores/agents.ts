import { create } from 'zustand';
import { buildAgentColorMap } from '@/lib/agent-colors';
import type { Agent } from '@/types';
import type { MockAgent } from '@/lib/mock-v2-data';

interface AgentsState {
  agents: Record<string, MockAgent>;
  sortedAgents: MockAgent[];
  agentColors: Record<string, string>;
  stats: { running: number; idle: number; totalCost: number };
  fetching: boolean;

  setAgents: (raw: Agent[]) => void;
  updateAgent: (agent: Agent) => void;
  setFetching: (v: boolean) => void;
  reset: () => void;
}

function sortAgents(agents: MockAgent[]): MockAgent[] {
  return [...agents].sort((a, b) => {
    if (a.role === 'lead' && b.role !== 'lead') return -1;
    if (b.role === 'lead' && a.role !== 'lead') return 1;
    return a.name.localeCompare(b.name);
  });
}

function computeStats(agents: MockAgent[]) {
  return {
    running: agents.filter((a) => a.status === 'running').length,
    idle: agents.filter((a) => a.status === 'idle').length,
    totalCost: agents.reduce((sum, a) => sum + Number(a.sessionCostUsd || 0), 0),
  };
}

export const useAgentsStore = create<AgentsState>()((set, get) => ({
  agents: {},
  sortedAgents: [],
  agentColors: {},
  stats: { running: 0, idle: 0, totalCost: 0 },
  fetching: false,

  setAgents: (raw) => {
    const agents: Record<string, MockAgent> = {};
    for (const a of raw as MockAgent[]) agents[a.id] = a;
    const sorted = sortAgents(raw as MockAgent[]);
    set({
      agents,
      sortedAgents: sorted,
      agentColors: buildAgentColorMap(sorted),
      stats: computeStats(sorted),
    });
  },

  updateAgent: (agent) => {
    const prev = get().agents;
    const updated = { ...prev, [agent.id]: agent as MockAgent };
    const all = Object.values(updated);
    const sorted = sortAgents(all);
    set({
      agents: updated,
      sortedAgents: sorted,
      agentColors: buildAgentColorMap(sorted),
      stats: computeStats(all),
    });
  },

  setFetching: (v) => set({ fetching: v }),
  reset: () =>
    set({
      agents: {},
      sortedAgents: [],
      agentColors: {},
      stats: { running: 0, idle: 0, totalCost: 0 },
      fetching: false,
    }),
}));
