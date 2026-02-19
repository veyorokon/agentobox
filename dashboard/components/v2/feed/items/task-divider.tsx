'use client';

import { ChevronRight, CheckCircle2 } from 'lucide-react';

interface TaskDividerProps {
  variant: 'start' | 'end';
  subject: string;
  agentName: string;
  agentColor: string;
  time: string;
}

export function TaskDivider({ variant, subject, agentName, agentColor, time }: TaskDividerProps) {
  const isStart = variant === 'start';
  const lineColor = isStart
    ? `color-mix(in srgb, ${agentColor} 30%, transparent)`
    : `color-mix(in srgb, ${agentColor} 15%, transparent)`;

  return (
    <div
      className="flex items-center justify-center gap-2 py-1.5 my-0.5"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <div className="h-px flex-1" style={{ background: lineColor }} />

      {isStart ? (
        <ChevronRight
          className="w-2.5 h-2.5 flex-shrink-0"
          style={{ color: agentColor }}
        />
      ) : (
        <CheckCircle2
          className="w-2.5 h-2.5 flex-shrink-0"
          style={{ color: agentColor, opacity: 0.6 }}
        />
      )}

      <span
        className="text-[8px] font-mono font-bold uppercase tracking-widest flex-shrink-0"
        style={{
          color: agentColor,
          opacity: isStart ? 1 : 0.6,
        }}
      >
        {agentName}
      </span>

      <span
        className="text-[8px] font-mono flex-shrink-0"
        style={{
          color: isStart
            ? 'var(--muted-foreground)'
            : 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
        }}
      >
        {subject}
      </span>

      <span className="text-[7px] font-mono text-muted-foreground/40 flex-shrink-0 tabular-nums">
        {time}
      </span>

      <div className="h-px flex-1" style={{ background: lineColor }} />
    </div>
  );
}
