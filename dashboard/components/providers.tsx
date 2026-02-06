'use client';

import { useEffect, useState } from 'react';
import { Provider as UrqlProvider } from 'urql';
import { useRouter, usePathname } from 'next/navigation';
import { client } from '@/lib/graphql/client';
import { useAuthStore } from '@/stores/auth';
import { ThemeProvider } from './theme-provider';
import { ErrorBoundary } from './error-boundary';
import { Toaster } from '@/components/ui/sonner';

const PUBLIC_PATHS = ['/login'];

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuthStore((s) => s.token);
  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!token && !isPublic) {
      router.replace('/login');
    }
  }, [token, isPublic, router]);

  if (!token && !isPublic) {
    return <div className="min-h-screen bg-background" />;
  }

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <UrqlProvider value={client}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        disableTransitionOnChange
      >
        <ErrorBoundary>
          <AuthGuard>{children}</AuthGuard>
        </ErrorBoundary>
        <Toaster position="bottom-right" />
      </ThemeProvider>
    </UrqlProvider>
  );
}
