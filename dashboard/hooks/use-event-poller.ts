'use client';

import { useEffect, useRef } from 'react';
import { useEventStore } from '@/stores';
import { API_URL } from '@/lib/constants';
import type { AgentEvent } from '@/types';

export function useEventPoller(projectId: string, intervalMs = 3000) {
  const setEvents = useEventStore((s) => s.setEvents);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/projects/${projectId}/events`);
        if (!res.ok || !active) return;
        const data = await res.json() as { events: AgentEvent[] };
        if (!active || data.events.length === 0) return;
        setEvents(projectId, data.events);
      } catch {
        // Server not running — silently skip
      }
    };

    poll();
    intervalRef.current = setInterval(poll, intervalMs);

    return () => {
      active = false;
      clearInterval(intervalRef.current);
    };
  }, [projectId, intervalMs, setEvents]);
}
