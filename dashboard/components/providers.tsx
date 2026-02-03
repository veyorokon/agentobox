'use client';

import { useEffect, useState } from 'react';
import { useBentoStore, useAgentStore, useEventStore, useChatStore } from '@/stores';
import { mockBentos, mockAgents, mockEvents, mockChat } from '@/lib/mock-data';
import { ThemeProvider } from './theme-provider';

function StoreInitializer() {
  const setBentos = useBentoStore((s) => s.setBentos);
  const setAgents = useAgentStore((s) => s.setAgents);
  const setEvents = useEventStore((s) => s.setEvents);
  const setMessages = useChatStore((s) => s.setMessages);

  useEffect(() => {
    // Initialize with mock data
    setBentos(mockBentos);

    for (const [bentoId, agents] of Object.entries(mockAgents)) {
      setAgents(bentoId, agents);
    }

    for (const [bentoId, events] of Object.entries(mockEvents)) {
      setEvents(bentoId, events);
    }

    for (const [bentoId, messages] of Object.entries(mockChat)) {
      setMessages(bentoId, messages);
    }
  }, [setBentos, setAgents, setEvents, setMessages]);

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
