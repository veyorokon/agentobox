import type { Agent } from '@/types';
import { STATUS_COLOR_VAR } from './status-badge';

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

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 py-0.5 hover:opacity-80 transition-opacity"
      style={
        isSelected
          ? { textDecoration: 'underline', textUnderlineOffset: '2px' }
          : undefined
      }
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: color }}
      />
      <span
        className="text-[11px] font-mono capitalize"
        style={{ color }}
      >
        {agent.name}
      </span>
    </button>
  );
}
