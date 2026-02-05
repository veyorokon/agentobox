'use client';

import { useEffect, useRef } from 'react';
import { useAgentStore, useEventStore, useChatStore } from '@/stores';
import { API_V1 } from '@/lib/constants';
import type { Agent, AgentStatus, AgentEvent, ChatMessage } from '@/types';

interface LiveAgent {
  name: string;
  status: AgentStatus;
  task: string;
  currentTask: string;
  lastEvent: string;
  vncPort: number;
  vncUrl: string;
  uptime: number;
}

function toAgent(live: LiveAgent): Agent {
  return {
    name: live.name,
    status: live.status,
    task: live.currentTask || live.task,
    message: live.lastEvent,
    createdAt: new Date(Date.now() - live.uptime * 1000).toISOString(),
    lastActivity: new Date().toISOString(),
    vncUrl: live.vncUrl,
  };
}

/**
 * Single SSE hook that replaces the 3 polling hooks.
 * Opens EventSource to /api/v1/projects/:id/stream and dispatches
 * agent_update, new_event, new_chat to Zustand stores.
 * Falls back to initial REST fetch on mount for current state.
 */
export function useSSE(projectId: string) {
  const setAgents = useAgentStore((s) => s.setAgents);
  const setEvents = useEventStore((s) => s.setEvents);
  const addEvent = useEventStore((s) => s.addEvent);
  const setMessages = useChatStore((s) => s.setMessages);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let active = true;

    // Initial REST fetch for current state
    async function loadInitial() {
      try {
        const [agentsRes, eventsRes, chatRes] = await Promise.all([
          fetch(`${API_V1}/projects/${projectId}/agents`),
          fetch(`${API_V1}/projects/${projectId}/events`),
          fetch(`${API_V1}/projects/${projectId}/chat`),
        ]);

        if (!active) return;

        if (agentsRes.ok) {
          const data = await agentsRes.json() as { agents: LiveAgent[] };
          if (data.agents.length > 0) {
            setAgents(projectId, data.agents.map(toAgent));
          }
        }

        if (eventsRes.ok) {
          const data = await eventsRes.json() as { events: AgentEvent[] };
          if (data.events.length > 0) {
            setEvents(projectId, data.events);
          }
        }

        if (chatRes.ok) {
          const data = await chatRes.json() as { messages: ChatMessage[] };
          if (data.messages.length > 0) {
            setMessages(projectId, data.messages);
          }
        }
      } catch {
        // Server not running — silently skip
      }
    }

    loadInitial();

    // Open SSE stream
    const es = new EventSource(`${API_V1}/projects/${projectId}/stream`);
    esRef.current = es;

    es.addEventListener('agent_update', (e) => {
      if (!active) return;
      try {
        const data = JSON.parse(e.data) as { agents: LiveAgent[] };
        setAgents(projectId, data.agents.map(toAgent));
      } catch { /* malformed SSE data */ }
    });

    es.addEventListener('new_event', (e) => {
      if (!active) return;
      try {
        const data = JSON.parse(e.data) as { event: AgentEvent };
        addEvent(projectId, data.event);
      } catch { /* malformed SSE data */ }
    });

    es.addEventListener('new_chat', (e) => {
      if (!active) return;
      try {
        const data = JSON.parse(e.data) as { message: ChatMessage };
        const existing = useChatStore.getState().messages[projectId] ?? [];
        if (!existing.some((m) => m.id === data.message.id)) {
          setMessages(projectId, [...existing, data.message]);
        }
      } catch { /* malformed SSE data */ }
    });

    return () => {
      active = false;
      es.close();
      esRef.current = null;
    };
  }, [projectId, setAgents, setEvents, addEvent, setMessages]);
}
