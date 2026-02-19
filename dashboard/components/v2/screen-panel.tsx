'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Monitor, Wifi, WifiOff, Maximize2, Minimize2 } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentsStore } from '@/stores/agents';

type ConnState = 'connecting' | 'connected' | 'disconnected';

function useIframeConnection(iframeKey: string | null) {
  const [state, setState] = useState<ConnState>('connecting');

  useEffect(() => {
    if (!iframeKey) {
      setState('disconnected');
      return;
    }
    setState('connecting');
    const t = setTimeout(() => setState('connected'), 2500);
    return () => clearTimeout(t);
  }, [iframeKey]);

  return state;
}

export function ScreenPanel() {
  const selectedAgentId = useDashboardStore((s) => s.selectedAgentId);
  const vncUrl = useAgentsStore((s) =>
    selectedAgentId ? s.agents[selectedAgentId]?.vncUrl ?? '' : ''
  );
  const agentName = useAgentsStore((s) =>
    selectedAgentId ? s.agents[selectedAgentId]?.name ?? '' : ''
  );
  const agentStatus = useAgentsStore((s) =>
    selectedAgentId ? s.agents[selectedAgentId]?.status ?? '' : ''
  );
  const agentColor = useAgentsStore((s) =>
    selectedAgentId
      ? s.agentColors[selectedAgentId] ?? 'var(--muted-foreground)'
      : 'var(--muted-foreground)'
  );

  const connState = useIframeConnection(selectedAgentId && vncUrl ? selectedAgentId : null);
  const [expanded, setExpanded] = useState(false);

  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Pass dashboard background color so noVNC viewer.html matches during loading
  const iframeSrc = useMemo(() => {
    if (!vncUrl) return '';
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--background')
      .trim()
      .replace('#', '');
    return `${vncUrl}/viewer.html${bg ? `?bg=${bg}` : ''}`;
  }, [vncUrl]);

  const isAlive = ['running', 'idle', 'deploying'].includes(agentStatus);

  if (!selectedAgentId || !vncUrl || !isAlive) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Monitor className="w-8 h-8 text-muted-foreground/15" />
        <span className="text-[10px] font-mono text-muted-foreground/30 uppercase tracking-widest">
          {selectedAgentId ? 'No desktop available' : 'Select an agent'}
        </span>
      </div>
    );
  }

  const header = (
    <div
      className="flex items-center gap-2 px-3 py-1 flex-shrink-0"
      style={{
        background: 'var(--background)',
        borderBottom: `1px solid color-mix(in srgb, ${agentColor} 12%, transparent)`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{
          background: isAlive ? agentColor : 'var(--muted-foreground)',
          boxShadow: isAlive ? `0 0 6px ${agentColor}` : 'none',
        }}
      />
      <span
        className="text-[9px] font-mono font-bold uppercase tracking-wider"
        style={{ color: agentColor }}
      >
        {agentName}
      </span>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        {connState === 'connected' ? (
          <Wifi className="w-2.5 h-2.5" style={{ color: agentColor, opacity: 0.4 }} />
        ) : connState === 'connecting' ? (
          <Wifi
            className="w-2.5 h-2.5 animate-pulse"
            style={{ color: 'var(--agent-deploying)', opacity: 0.5 }}
          />
        ) : (
          <WifiOff className="w-2.5 h-2.5" style={{ color: 'var(--muted-foreground)', opacity: 0.3 }} />
        )}
        <span
          className="text-[8px] font-mono uppercase tracking-wider"
          style={{
            color:
              connState === 'connected'
                ? agentColor
                : connState === 'connecting'
                  ? 'var(--agent-deploying)'
                  : 'var(--muted-foreground)',
            opacity: 0.4,
          }}
        >
          {connState === 'connected' ? 'Live' : connState === 'connecting' ? 'Connecting' : 'Offline'}
        </span>
      </div>

      <button
        onClick={toggleExpand}
        className="p-0.5 rounded-sm transition-colors hover:bg-white/5"
        title={expanded ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
      >
        {expanded ? (
          <Minimize2 className="w-3 h-3 text-muted-foreground/30 hover:text-muted-foreground" />
        ) : (
          <Maximize2 className="w-3 h-3 text-muted-foreground/30 hover:text-muted-foreground" />
        )}
      </button>
    </div>
  );

  const loadingOverlay = connState !== 'connected' && (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background">
      {/* Expanding signal rings */}
      <div className="relative flex items-center justify-center">
        {/* Ring 1 */}
        <div
          className="absolute w-8 h-8 rounded-full border"
          style={{
            borderColor: agentColor,
            opacity: 0.15,
            animation: 'vnc-ring 2.4s ease-out infinite',
          }}
        />
        {/* Ring 2 (delayed) */}
        <div
          className="absolute w-8 h-8 rounded-full border"
          style={{
            borderColor: agentColor,
            opacity: 0.15,
            animation: 'vnc-ring 2.4s ease-out infinite 0.8s',
          }}
        />
        {/* Ring 3 (delayed more) */}
        <div
          className="absolute w-8 h-8 rounded-full border"
          style={{
            borderColor: agentColor,
            opacity: 0.15,
            animation: 'vnc-ring 2.4s ease-out infinite 1.6s',
          }}
        />
        {/* Center glow */}
        <div
          className="absolute w-6 h-6 rounded-full"
          style={{
            background: agentColor,
            animation: 'vnc-glow 2s ease-in-out infinite',
          }}
        />
        {/* Center dot */}
        <div
          className="relative w-2 h-2 rounded-full"
          style={{
            background: agentColor,
            boxShadow: `0 0 8px ${agentColor}`,
          }}
        />
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-1.5 mt-6">
        <span
          className="text-[9px] font-mono font-bold uppercase tracking-[0.25em]"
          style={{ color: agentColor, opacity: 0.5 }}
        >
          {agentName}
        </span>
        <span
          className="text-[8px] font-mono uppercase tracking-[0.3em]"
          style={{ color: agentColor, opacity: 0.25 }}
        >
          Establishing connection
        </span>
      </div>

      {/* Scanline texture */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.02) 2px, rgba(0,0,0,0.02) 4px)',
        }}
      />
    </div>
  );

  if (expanded) {
    return (
      <>
        <div className="flex-1" />
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: 'var(--background)' }}
        >
          {header}
          <div className="flex-1 overflow-hidden relative">
            {loadingOverlay}
            <iframe
              key={`${selectedAgentId}-fs`}
              src={iframeSrc}
              className="w-full h-full border-0"
              allow="clipboard-read; clipboard-write"
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {header}
      <div className="flex-1 flex items-start justify-center overflow-hidden bg-background">
        <div className="w-full relative" style={{ aspectRatio: '16 / 9', maxHeight: '100%' }}>
          {loadingOverlay}
          <iframe
            key={selectedAgentId}
            src={iframeSrc}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      </div>
    </div>
  );
}
