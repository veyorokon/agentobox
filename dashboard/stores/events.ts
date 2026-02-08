import { create } from 'zustand';
import type { AgentEvent } from '@/types';

const MAX_EVENTS = 100;

interface EventsState {
  events: Record<string, AgentEvent[]>; // keyed by projectId
  addEvent: (projectId: string, event: AgentEvent) => void;
  setEvents: (projectId: string, events: AgentEvent[]) => void;
}

export const useEventsStore = create<EventsState>((set) => ({
  events: {},

  addEvent: (projectId, event) =>
    set((state) => {
      const current = state.events[projectId] ?? [];
      // Dedupe by id — subscription may arrive after initial query
      if (event.id && current.some((e) => e.id === event.id)) {
        return state;
      }
      const updated = [...current, event].slice(-MAX_EVENTS);
      return { events: { ...state.events, [projectId]: updated } };
    }),

  setEvents: (projectId, events) =>
    set((state) => ({
      events: { ...state.events, [projectId]: events.slice(-MAX_EVENTS) },
    })),
}));
