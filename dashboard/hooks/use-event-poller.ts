'use client';

import { useEffect, useRef } from 'react';
import { useEventStore } from '@/stores';
import type { AgentEvent } from '@/types';

const POLL_URL = 'http://localhost:9900/events';

export function useEventPoller(bentoId: string, intervalMs = 3000) {
  const setEvents = useEventStore((s) => s.setEvents);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(POLL_URL);
        if (!res.ok || !active) return;
        const data = await res.json() as { events: AgentEvent[] };
        if (!active || data.events.length === 0) return;
        setEvents(bentoId, data.events);
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
  }, [bentoId, intervalMs, setEvents]);
}
