import { create } from 'zustand';
import type { AgentEvent, AgentStatus } from '@/types';
import { useAgentStore } from './agents';

/** Derive latest status per agent from events and sync to agent store */
function syncAgentStatus(projectId: string, events: AgentEvent[]) {
  const latest = new Map<string, AgentEvent>();
  for (const event of events) {
    const existing = latest.get(event.agent);
    if (!existing || new Date(event.ts) > new Date(existing.ts)) {
      latest.set(event.agent, event);
    }
  }
  const { updateAgent } = useAgentStore.getState();
  for (const [name, event] of latest) {
    updateAgent(projectId, name, { status: event.state, message: event.msg });
  }
}

interface EventFilters {
  agents: string[];
  states: AgentStatus[];
}

interface EventStore {
  events: Record<string, AgentEvent[]>; // projectId -> events
  filters: EventFilters;
  setEvents: (projectId: string, events: AgentEvent[]) => void;
  addEvent: (projectId: string, event: AgentEvent) => void;
  getEventsForProject: (projectId: string) => AgentEvent[];
  getFilteredEvents: (projectId: string) => AgentEvent[];
  getEventsForAgent: (projectId: string, agentName: string) => AgentEvent[];
  setFilters: (filters: Partial<EventFilters>) => void;
  clearFilters: () => void;
}

const defaultFilters: EventFilters = {
  agents: [],
  states: [],
};

export const useEventStore = create<EventStore>()((set, get) => ({
  events: {},
  filters: defaultFilters,

  setEvents: (projectId, events) => {
    set((state) => ({
      events: { ...state.events, [projectId]: events },
    }));
    syncAgentStatus(projectId, events);
  },

  addEvent: (projectId, event) => {
    set((state) => ({
      events: {
        ...state.events,
        [projectId]: [event, ...(state.events[projectId] || [])].slice(0, 100),
      },
    }));
    useAgentStore.getState().updateAgent(projectId, event.agent, {
      status: event.state,
      message: event.msg,
    });
  },

  getEventsForProject: (projectId) => get().events[projectId] || [],

  getFilteredEvents: (projectId) => {
    const { events, filters } = get();
    const projectEvents = events[projectId] || [];

    return projectEvents.filter((event) => {
      if (filters.agents.length > 0 && !filters.agents.includes(event.agent)) {
        return false;
      }
      if (filters.states.length > 0 && !filters.states.includes(event.state)) {
        return false;
      }
      return true;
    });
  },

  getEventsForAgent: (projectId, agentName) =>
    (get().events[projectId] || []).filter((e) => e.agent === agentName),

  setFilters: (newFilters) =>
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
    })),

  clearFilters: () => set({ filters: defaultFilters }),
}));
