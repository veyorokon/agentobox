import { create } from 'zustand';
import type { AgentEvent, AgentStatus } from '@/types';
import { useAgentStore } from './agents';

/** Derive latest status per agent from events and sync to agent store */
function syncAgentStatus(bentoId: string, events: AgentEvent[]) {
  const latest = new Map<string, AgentEvent>();
  for (const event of events) {
    const existing = latest.get(event.agent);
    if (!existing || new Date(event.ts) > new Date(existing.ts)) {
      latest.set(event.agent, event);
    }
  }
  const { updateAgent } = useAgentStore.getState();
  for (const [name, event] of latest) {
    updateAgent(bentoId, name, { status: event.state, message: event.msg });
  }
}

interface EventFilters {
  agents: string[];
  states: AgentStatus[];
}

interface EventStore {
  events: Record<string, AgentEvent[]>; // bentoId -> events
  filters: EventFilters;
  setEvents: (bentoId: string, events: AgentEvent[]) => void;
  addEvent: (bentoId: string, event: AgentEvent) => void;
  getEventsForBento: (bentoId: string) => AgentEvent[];
  getFilteredEvents: (bentoId: string) => AgentEvent[];
  getEventsForAgent: (bentoId: string, agentName: string) => AgentEvent[];
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

  setEvents: (bentoId, events) => {
    set((state) => ({
      events: { ...state.events, [bentoId]: events },
    }));
    syncAgentStatus(bentoId, events);
  },

  addEvent: (bentoId, event) => {
    set((state) => ({
      events: {
        ...state.events,
        [bentoId]: [event, ...(state.events[bentoId] || [])].slice(0, 100),
      },
    }));
    useAgentStore.getState().updateAgent(bentoId, event.agent, {
      status: event.state,
      message: event.msg,
    });
  },

  getEventsForBento: (bentoId) => get().events[bentoId] || [],

  getFilteredEvents: (bentoId) => {
    const { events, filters } = get();
    const bentoEvents = events[bentoId] || [];

    return bentoEvents.filter((event) => {
      if (filters.agents.length > 0 && !filters.agents.includes(event.agent)) {
        return false;
      }
      if (filters.states.length > 0 && !filters.states.includes(event.state)) {
        return false;
      }
      return true;
    });
  },

  getEventsForAgent: (bentoId, agentName) =>
    (get().events[bentoId] || []).filter((e) => e.agent === agentName),

  setFilters: (newFilters) =>
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
    })),

  clearFilters: () => set({ filters: defaultFilters }),
}));
