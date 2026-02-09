import type { Agent } from '@/types';
import { STATUS_COLOR_VAR } from './status-badge';

const STATUS_SHORT: Record<string, string> = {
  deploying: 'DEPLOY',
  running: 'ACTIVE',
  idle: 'IDLE',
  stopped: 'OFF',
  error: 'ERR',
};

export function RosterBadge({
  agent,
  isSelected,
  onClick,
}: {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}) {
  const color = STATUS_COLOR_VAR[agent.status];
  const isActive = agent.status === 'running';

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded transition-all duration-200"
      style={{
        background: isSelected
          ? `color-mix(in srgb, ${color} 10%, transparent)`
          : 'transparent',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{
          background: color,
          boxShadow: isActive ? `0 0 6px ${color}` : 'none',
          animation: isActive ? 'border-pulse 2s ease-in-out infinite' : 'none',
        }}
      />
      <span
        className="text-[11px] font-mono font-semibold capitalize transition-colors duration-200"
        style={{ color: isSelected ? 'var(--foreground)' : 'var(--muted-foreground)' }}
      >
        {agent.name}
      </span>
      <span
        className="text-[8px] font-mono font-bold uppercase tracking-wider"
        style={{ color, opacity: 0.6 }}
      >
        {STATUS_SHORT[agent.status] || agent.status.toUpperCase()}
      </span>
    </button>
  );
}
