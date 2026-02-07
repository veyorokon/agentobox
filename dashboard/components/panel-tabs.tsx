import type { Agent, AgentStatus } from '@/types';
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
  const tabClass = (tab: PanelTab) =>
    `px-3 py-2 text-[10px] font-bold font-mono uppercase tracking-wider transition-colors ${
      active === tab
        ? 'text-accent'
        : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div
      className="flex items-center gap-0 mx-5"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <button className={tabClass('feed')} onClick={() => onSelect('feed')}>
        <span
          style={
            active === 'feed'
              ? { borderBottom: '2px solid var(--accent)', paddingBottom: '6px' }
              : undefined
          }
        >
          Feed
        </span>
      </button>
      {selectedAgent && (
        <button
          className={tabClass(selectedAgent.name)}
          onClick={() => onSelect(selectedAgent.name)}
        >
          <span
            style={{
              color:
                active === selectedAgent.name
                  ? STATUS_COLOR_VAR[selectedAgent.status]
                  : undefined,
              borderBottom:
                active === selectedAgent.name
                  ? `2px solid ${STATUS_COLOR_VAR[selectedAgent.status]}`
                  : undefined,
              paddingBottom: active === selectedAgent.name ? '6px' : undefined,
            }}
          >
            {selectedAgent.name}
          </span>
        </button>
      )}
    </div>
  );
}
