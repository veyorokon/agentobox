'use client';

import { useEffect, useState } from 'react';
import { useProjectStore, useAgentStore, useEventStore, useChatStore } from '@/stores';
import { mockProjects, mockAgents, mockEvents, mockChat } from '@/lib/mock-data';
import { useSSE } from '@/hooks/use-sse';
import { ThemeProvider } from './theme-provider';

function StoreInitializer() {
  const setProjects = useProjectStore((s) => s.setProjects);
  const setAgents = useAgentStore((s) => s.setAgents);
  const setEvents = useEventStore((s) => s.setEvents);
  const setMessages = useChatStore((s) => s.setMessages);

  useEffect(() => {
    setProjects(mockProjects);

    for (const [projectId, agents] of Object.entries(mockAgents)) {
      setAgents(projectId, agents);
    }

    for (const [projectId, events] of Object.entries(mockEvents)) {
      setEvents(projectId, events);
    }

    for (const [projectId, messages] of Object.entries(mockChat)) {
      setMessages(projectId, messages);
    }
  }, [setProjects, setAgents, setEvents, setMessages]);

  // SSE stream — real-time updates, replaces polling
  useSSE('project-1');

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-950" />
    );
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <StoreInitializer />
      {children}
    </ThemeProvider>
  );
}
