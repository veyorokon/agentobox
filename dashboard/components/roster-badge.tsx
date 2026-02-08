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
      data-augmented-ui="tl-clip br-clip border"
      className="flex items-center gap-2 px-2.5 py-1 transition-all duration-200 group"
      style={{
        '--aug-tl': '5px',
        '--aug-br': '5px',
        '--aug-border-all': isSelected ? '1.5px' : '1px',
        '--aug-border-bg': isSelected ? color : 'var(--border)',
        background: isSelected
          ? `color-mix(in srgb, ${color} 8%, transparent)`
          : 'transparent',
      } as React.CSSProperties}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
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
        style={{ color, opacity: 0.7 }}
      >
        {STATUS_SHORT[agent.status] || agent.status.toUpperCase()}
      </span>
    </button>
  );
}
