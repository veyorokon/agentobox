'use client';

import { RotateCw, X } from 'lucide-react';

export interface PendingMessage {
  id: string;
  text: string;
  targetIds: string[];
  targetNames: string[];
  targetColor: string;
  status: 'sending' | 'queued' | 'failed';
  error?: string;
}

interface TransmissionStripProps {
  messages: PendingMessage[];
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
  onEdit: (id: string) => void;
}

export function TransmissionStrip({ messages, onRetry, onDiscard, onEdit }: TransmissionStripProps) {
  if (messages.length === 0) return null;

  return (
    <div className="px-3 pt-0.5 pb-1 space-y-0.5">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className="flex items-center gap-2 py-0.5 pl-2"
          style={{
            borderLeft: `2px solid ${msg.status === 'failed' ? 'var(--destructive, #ef4444)' : msg.targetColor}`,
            animation: msg.status === 'sending'
              ? 'tx-pulse 1.5s ease-in-out infinite'
              : msg.status === 'queued'
                ? 'tx-confirmed 1.5s ease-out forwards'
                : undefined,
          } as React.CSSProperties}
        >
          {/* Message preview — click to pull back into input on failure */}
          <button
            onClick={msg.status === 'failed' ? () => onEdit(msg.id) : undefined}
            className={`text-[9px] font-mono truncate flex-1 text-left ${
              msg.status === 'failed'
                ? 'text-destructive/60 cursor-pointer hover:text-destructive/80'
                : 'text-muted-foreground/40 cursor-default'
            }`}
            disabled={msg.status !== 'failed'}
            title={msg.status === 'failed' ? 'Click to edit' : undefined}
          >
            {msg.text.length > 60 ? msg.text.slice(0, 60) + '...' : msg.text}
          </button>

          {/* Target */}
          <span
            className="text-[7px] font-mono font-bold uppercase tracking-wider flex-shrink-0"
            style={{ color: msg.targetColor, opacity: 0.5 }}
          >
            {msg.targetNames.length > 2
              ? `→ ${msg.targetNames.length} agents`
              : `→ ${msg.targetNames.join(', ')}`}
          </span>

          {/* Status label */}
          <span
            className="text-[7px] font-mono font-bold uppercase tracking-[0.15em] flex-shrink-0 w-6 text-right"
            style={{
              color: msg.status === 'failed'
                ? 'var(--destructive, #ef4444)'
                : 'var(--muted-foreground)',
              opacity: msg.status === 'failed' ? 0.7 : 0.35,
            }}
          >
            {msg.status === 'sending' && 'TX'}
            {msg.status === 'queued' && 'OK'}
            {msg.status === 'failed' && 'ERR'}
          </span>

          {/* Retry + discard (failure only) */}
          {msg.status === 'failed' && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={() => onRetry(msg.id)}
                className="p-0.5 text-muted-foreground/30 hover:text-accent transition-colors"
                title="Retry"
              >
                <RotateCw className="w-2.5 h-2.5" />
              </button>
              <button
                onClick={() => onDiscard(msg.id)}
                className="p-0.5 text-muted-foreground/30 hover:text-destructive transition-colors"
                title="Discard"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
