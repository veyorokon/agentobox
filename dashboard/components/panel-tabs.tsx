import type { Agent } from '@/types';
import { STATUS_COLOR_VAR } from './status-badge';

export type PanelTab = 'feed' | (string & {});

export function PanelTabs({
  active,
  selectedAgent,
  onSelect,
}: {
  active: PanelTab;
  selectedAgent: Agent | null | undefined;
  onSelect: (tab: PanelTab) => void;
}) {
  return (
    <div
      className="flex items-center mx-5"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <TabButton
        label="Feed"
        isActive={active === 'feed'}
        color="var(--accent)"
        onClick={() => onSelect('feed')}
      />
      {selectedAgent && (
        <TabButton
          label={selectedAgent.name}
          isActive={active === selectedAgent.name}
          color={STATUS_COLOR_VAR[selectedAgent.status]}
          onClick={() => onSelect(selectedAgent.name)}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  isActive,
  color,
  onClick,
}: {
  label: string;
  isActive: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      className="relative px-4 py-2.5 text-[10px] font-bold font-mono uppercase tracking-wider transition-colors duration-200 hover:text-foreground"
      onClick={onClick}
      style={{
        color: isActive ? color : undefined,
      }}
    >
      {label}
      <span
        className="absolute bottom-0 left-2 right-2 h-[2px] transition-all duration-300"
        style={{
          background: color,
          opacity: isActive ? 1 : 0,
          transform: isActive ? 'scaleX(1)' : 'scaleX(0)',
        }}
      />
    </button>
  );
}
