'use client';

import { CheckCircle2 } from 'lucide-react';

interface TaskLineProps {
  agentName: string;
  agentColor: string;
  summary: string;
}

export function TaskLine({ agentName, agentColor, summary }: TaskLineProps) {
  return (
    <div
      className="flex items-center gap-2 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: agentColor, opacity: 0.7 }} />
      <span
        className="text-[9px] font-mono font-bold flex-shrink-0"
        style={{ color: agentColor, opacity: 0.8 }}
      >
        {agentName}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/70 truncate">
        {summary}
      </span>
    </div>
  );
}
