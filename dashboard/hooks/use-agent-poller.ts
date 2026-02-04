'use client';

import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores';
import { API_URL } from '@/lib/constants';
import type { Agent, AgentStatus } from '@/types';

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

export function useAgentPoller(projectId: string, intervalMs = 3000) {
  const setAgents = useAgentStore((s) => s.setAgents);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/projects/${projectId}/agents`);
        if (!res.ok || !active) return;
        const data = await res.json() as { agents: LiveAgent[] };
        if (!active) return;
        if (data.agents.length > 0) {
          setAgents(projectId, data.agents.map(toAgent));
        }
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
  }, [projectId, intervalMs, setAgents]);
}
