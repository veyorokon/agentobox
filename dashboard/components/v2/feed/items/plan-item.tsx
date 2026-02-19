'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface PlanItemProps {
  agentName: string;
  agentColor: string;
  planStatus: 'content' | 'approved';
  planSummary: string;
  planSteps?: string[];
}

export function PlanItem({ agentName, agentColor, planStatus, planSummary, planSteps }: PlanItemProps) {
  const [expanded, setExpanded] = useState(false);

  if (planStatus === 'approved') {
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
          plan approved — executing
        </span>
      </div>
    );
  }

  return (
    <div
      className="px-1 py-0.5"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span
          className="text-[9px] font-mono flex-shrink-0 leading-none"
          style={{ color: agentColor, opacity: 0.7 }}
        >
          {expanded ? '▾' : '▸'}
        </span>
        <span
          className="text-[9px] font-mono font-bold flex-shrink-0"
          style={{ color: agentColor, opacity: 0.8 }}
        >
          {agentName}
        </span>
        <span
          className="text-[9px] font-mono font-bold flex-shrink-0"
          style={{ color: agentColor, opacity: 0.6 }}
        >
          plan:
        </span>
        <span className="text-[9px] font-mono text-foreground/80 truncate">
          &ldquo;{planSummary}&rdquo;
        </span>
      </button>

      {expanded && planSteps && planSteps.length > 0 && (
        <div
          className="ml-3 mt-1 pl-2 space-y-0.5"
          style={{ borderLeft: `1px solid color-mix(in srgb, ${agentColor} 40%, transparent)` }}
        >
          {planSteps.map((step, i) => (
            <div key={i} className="flex items-baseline gap-1.5">
              <span
                className="text-[8px] font-mono tabular-nums flex-shrink-0"
                style={{ color: agentColor, opacity: 0.5 }}
              >
                {i + 1}.
              </span>
              <span className="text-[9px] font-mono text-muted-foreground/70">
                {step}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
