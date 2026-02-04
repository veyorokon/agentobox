'use client';

import { useEffect, useRef } from 'react';
import { useChatStore } from '@/stores';
import { API_URL } from '@/lib/constants';
import type { ChatMessage } from '@/types';

export function useChatPoller(projectId: string, intervalMs = 3000) {
  const setMessages = useChatStore((s) => s.setMessages);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const lastTsRef = useRef<string>('');

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const since = lastTsRef.current ? `?since=${encodeURIComponent(lastTsRef.current)}` : '';
        const res = await fetch(`${API_URL}/projects/${projectId}/chat${since}`);
        if (!res.ok || !active) return;
        const data = await res.json() as { messages: ChatMessage[] };
        if (!active || data.messages.length === 0) return;

        // Track latest timestamp for incremental polling
        const latest = data.messages[data.messages.length - 1];
        if (latest) lastTsRef.current = latest.ts;

        if (since) {
          // Incremental: merge with existing
          const existing = useChatStore.getState().messages[projectId] ?? [];
          const existingIds = new Set(existing.map(m => m.id));
          const newMsgs = data.messages.filter(m => !existingIds.has(m.id));
          if (newMsgs.length > 0) {
            setMessages(projectId, [...existing, ...newMsgs]);
          }
        } else {
          // Full load
          setMessages(projectId, data.messages);
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
  }, [projectId, intervalMs, setMessages]);
}
