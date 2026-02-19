'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorBubbleProps {
  errorText: string;
  agentName: string;
  agentColor: string;
  agentId: string;
  onRestart?: (agentId: string) => void;
}

export function ErrorBubble({ errorText, agentName, agentColor, agentId, onRestart }: ErrorBubbleProps) {
  const truncated = errorText.length > 300 ? errorText.slice(0, 300) + '...' : errorText;

  return (
    <div
      className="flex justify-start"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="max-w-[90%] w-full">
        <div className="flex items-center gap-1.5 mb-1">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--agent-dead)' }} />
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider"
            style={{ color: agentColor }}
          >
            {agentName}
          </span>
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wider"
            style={{ color: 'var(--agent-dead)' }}
          >
            error
          </span>
        </div>
        <div
          className="px-3 py-2 rounded-sm"
          style={{
            background: 'color-mix(in srgb, var(--agent-dead) 6%, var(--card))',
            borderLeft: '2px solid var(--agent-dead)',
          }}
        >
          <pre className="text-[10px] font-mono text-muted-foreground/80 whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto">
            {truncated}
          </pre>
          <button
            onClick={() => onRestart?.(agentId)}
            className="mt-2 flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-wider transition-colors hover:opacity-80"
            style={{ color: 'var(--agent-dead)' }}
          >
            <RotateCw className="w-3 h-3" />
            Restart
          </button>
        </div>
      </div>
    </div>
  );
}
