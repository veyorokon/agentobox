import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
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

// ---------------------------------------------------------------------------
// Store with Redux DevTools integration
// ---------------------------------------------------------------------------
// Every set() call has a named action (3rd arg) so Redux DevTools shows:
//   - Full action timeline with timestamps
//   - State diff for each action (before/after)
//   - Time-travel debugging (rewind/replay)
//
// Install "Redux DevTools" browser extension, then open DevTools → Redux tab.
// Filter by "agents/" to see only agent store mutations.
// ---------------------------------------------------------------------------

export const useAgentsStore = create<AgentsState>()(
  devtools(
    (set, get) => ({
      agents: {},
      sortedAgents: [],
      agentColors: {},
      stats: { running: 0, idle: 0, totalCost: 0 },
      fetching: false,

      setAgents: (raw) => {
        const agents: Record<string, MockAgent> = {};
        for (const a of raw as MockAgent[]) agents[a.id] = a;
        const sorted = sortAgents(raw as MockAgent[]);
        set(
          {
            agents,
            sortedAgents: sorted,
            agentColors: buildAgentColorMap(sorted),
            stats: computeStats(sorted),
          },
          false,
          'agents/setAgents',
        );
      },

      updateAgent: (agent) => {
        const prev = get().agents;
        const updated = { ...prev, [agent.id]: agent as MockAgent };
        const all = Object.values(updated);
        const sorted = sortAgents(all);
        set(
          {
            agents: updated,
            sortedAgents: sorted,
            agentColors: buildAgentColorMap(sorted),
            stats: computeStats(all),
          },
          false,
          `agents/updateAgent:${(agent as MockAgent).name}`,
        );
      },

      setFetching: (v) => set({ fetching: v }, false, `agents/setFetching:${v}`),
      reset: () =>
        set(
          {
            agents: {},
            sortedAgents: [],
            agentColors: {},
            stats: { running: 0, idle: 0, totalCost: 0 },
            fetching: false,
          },
          false,
          'agents/reset',
        ),
    }),
    { name: 'AgentsStore', enabled: process.env.NODE_ENV !== 'production' },
  ),
);

// ---------------------------------------------------------------------------
// Dev-only: console diff logging for agent-map changes
// ---------------------------------------------------------------------------
// Zustand's subscribe(listener) provides (state, prevState) on every change.
// We only log when the agents map reference changes, showing a compact diff
// of added/removed/status-changed agents.
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  useAgentsStore.subscribe((state, prevState) => {
    if (state.agents === prevState.agents) return;

    const prev = prevState.agents;
    const next = state.agents;
    const prevIds = new Set(Object.keys(prev));
    const nextIds = new Set(Object.keys(next));

    const added = [...nextIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !nextIds.has(id));
    const changed = [...nextIds].filter(
      (id) => prevIds.has(id) && prev[id].status !== next[id].status,
    );

    const parts: string[] = [];
    for (const id of added) parts.push(`+${next[id].name}:${next[id].status}`);
    for (const id of removed) parts.push(`-${prev[id].name}:${prev[id].status}`);
    for (const id of changed)
      parts.push(`${next[id].name}:${prev[id].status}\u2192${next[id].status}`);

    if (parts.length > 0) {
      console.log(`[agents] ${parts.join(', ')} | total=${Object.keys(next).length}`);
    }
  });
}
