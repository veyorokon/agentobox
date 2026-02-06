'use client';

import { useState, useEffect } from 'react';

export function VncFrame({
  url,
  onRefresh,
}: {
  url: string;
  onRefresh?: (refresh: () => void) => void;
}) {
  const [connected, setConnected] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    onRefresh?.(() => setRetryKey((k) => k + 1));
  }, [onRefresh]);

  useEffect(() => {
    setConnected(false);
    let cancelled = false;
    const check = async () => {
      try {
        await fetch(url, { mode: 'no-cors' });
        if (!cancelled) setConnected(true);
      } catch {
        if (!cancelled) setTimeout(check, 3000);
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [url, retryKey]);

  if (!connected) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Connecting to VNC...
      </div>
    );
  }

  return (
    <iframe
      src={`${url}/?autoconnect=1&resize=scale&password=password`}
      className="w-full h-full border-0"
      allow="clipboard-read; clipboard-write"
      onError={() => setConnected(false)}
    />
  );
}
