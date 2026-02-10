'use client';

import { STATUS_COLOR_VAR } from './status-badge';
import type { Agent } from '@/types';

interface AgentListItemProps {
  agent: Agent;
  onClick?: () => void;
}

export function AgentListItem({ agent, onClick }: AgentListItemProps) {
  const statusColor = STATUS_COLOR_VAR[agent.status];
  const isWorking = agent.status === 'running';

  return (
    <button
      onClick={onClick}
      data-augmented-ui="tl-clip br-clip border"
      className="w-full px-3 py-2.5 flex items-center gap-3 text-left transition-all hover:bg-surface-inset"
      style={{
        '--aug-tl': '6px',
        '--aug-br': '6px',
        '--aug-border-all': '1px',
        '--aug-border-bg': statusColor,
        background: isWorking ? 'var(--agent-glow)' : 'transparent',
      } as React.CSSProperties}
    >
      {/* Status indicator */}
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: statusColor,
          boxShadow: isWorking ? `0 0 8px ${statusColor}` : 'none',
          animation: isWorking ? 'border-pulse 2s ease-in-out infinite' : 'none',
        }}
      />

      {/* Agent info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-mono font-bold truncate"
            style={{ color: statusColor }}
          >
            {agent.name}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
            {agent.status}
          </span>
          {agent.sessionCostUsd !== null && (
            <>
              <span className="text-[9px] text-muted-foreground/50">&middot;</span>
              <span className="text-[9px] font-mono text-muted-foreground">
                ${Number(agent.sessionCostUsd || 0).toFixed(3)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Avatar */}
      <div
        data-augmented-ui="tl-clip br-clip border"
        className="w-8 h-8 flex items-center justify-center flex-shrink-0"
        style={{
          '--aug-tl': '5px',
          '--aug-br': '5px',
          '--aug-border-all': '1.5px',
          '--aug-border-bg': statusColor,
        } as React.CSSProperties}
      >
        <span
          className="text-[10px] font-bold uppercase"
          style={{ color: statusColor }}
        >
          {agent.name.slice(0, 2)}
        </span>
      </div>
    </button>
  );
}
