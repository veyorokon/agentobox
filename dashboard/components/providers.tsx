'use client';

import { useEffect, useState } from 'react';
import { useProjectStore } from '@/stores';
import { useSSE } from '@/hooks/use-sse';
import { ThemeProvider } from './theme-provider';
import { ErrorBoundary } from './error-boundary';
import { Toaster } from '@/components/ui/sonner';

function StoreInitializer() {
  const setProjects = useProjectStore((s) => s.setProjects);

  useEffect(() => {
    // Seed a default project until project management is built
    setProjects([{
      id: 'project-1',
      name: 'agentobox',
      agents: [],
      agentoOnline: true,
      lastActivity: new Date().toISOString(),
    }]);
  }, [setProjects]);

  // SSE stream — real-time updates from server
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
      <ErrorBoundary>
        <StoreInitializer />
        {children}
      </ErrorBoundary>
      <Toaster position="bottom-right" />
    </ThemeProvider>
  );
}
