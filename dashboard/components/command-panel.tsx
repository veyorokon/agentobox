'use client';

import { ChevronsLeft, ChevronsRight, Plus, Crown } from 'lucide-react';
import { getAgentColor } from '@/lib/agent-colors';
import { STATUS_COLOR_VAR } from './status-badge';
import type { Agent } from '@/types';

interface CommandPanelProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  onDeploy: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

export function CommandPanel({
  agents,
  selectedAgentId,
  onSelectAgent,
  onDeploy,
  collapsed,
  onToggle,
}: CommandPanelProps) {
  if (collapsed) {
    return (
      <aside
        className="w-12 flex-shrink-0 flex flex-col items-center bg-surface py-3 gap-2 transition-all duration-200"
        style={{ borderRight: '1px solid var(--border)' }}
      >
        {/* Agent dots */}
        <div className="flex-1 flex flex-col items-center gap-1.5 overflow-y-auto scrollbar-thin">
          {agents.map((agent) => {
            const color = getAgentColor(agent.name, agent.role);
            const statusColor = STATUS_COLOR_VAR[agent.status];
            const isActive = agent.status === 'running';
            const isSelected = selectedAgentId === agent.id;
            return (
              <button
                key={agent.id}
                title={`${agent.name} — ${agent.status}`}
                onClick={() => onSelectAgent(isSelected ? null : agent.id)}
                className="w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-sm transition-all"
                style={{
                  background: isSelected
                    ? `color-mix(in srgb, ${color} 15%, transparent)`
                    : 'transparent',
                  borderLeft: `2px solid ${isSelected ? color : 'transparent'}`,
                }}
              >
                <span
                  className="text-[10px] font-mono font-bold uppercase relative"
                  style={{ color }}
                >
                  {agent.name.slice(0, 2)}
                  {/* Status indicator */}
                  <span
                    className="absolute -top-0.5 -right-1.5 w-1.5 h-1.5 rounded-full"
                    style={{
                      background: statusColor,
                      animation: isActive ? 'border-pulse 2s ease-in-out infinite' : 'none',
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={onToggle}
          className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          title="Expand (⌘B)"
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="w-60 flex-shrink-0 flex flex-col bg-surface transition-all duration-200"
      style={{ borderRight: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Agents
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onDeploy}
            className="w-6 h-6 flex items-center justify-center text-accent hover:text-accent/80 transition-colors"
            title="Deploy agent"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggle}
            className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            title="Collapse (⌘B)"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-3">
        {agents.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-muted-foreground/40 text-[10px] font-mono text-center">
              No agents deployed
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* "All" option — deselects any agent */}
            <button
              onClick={() => onSelectAgent(null)}
              className="w-full px-2.5 py-2 flex items-center gap-2 text-left rounded-sm transition-all"
              style={{
                background: selectedAgentId === null
                  ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                  : 'transparent',
                borderLeft: `2px solid ${selectedAgentId === null ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              <span className="text-xs font-mono text-muted-foreground">
                All agents
              </span>
            </button>

            {/* Individual agents */}
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                isSelected={selectedAgentId === agent.id}
                onSelect={() =>
                  onSelectAgent(selectedAgentId === agent.id ? null : agent.id)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Deploy button */}
      <div className="px-3 pb-3">
        <button
          onClick={onDeploy}
          data-augmented-ui="tl-clip br-clip border"
          className="w-full py-2 text-accent-foreground font-bold text-[10px] uppercase tracking-wider bg-accent text-center"
          style={{
            '--aug-tl': '6px',
            '--aug-br': '6px',
            '--aug-border-all': '1.5px',
            '--aug-border-bg': 'var(--accent)',
          } as React.CSSProperties}
        >
          + Deploy Agent
        </button>
      </div>
    </aside>
  );
}

function AgentRow({
  agent,
  isSelected,
  onSelect,
}: {
  agent: Agent;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = getAgentColor(agent.name, agent.role);
  const statusColor = STATUS_COLOR_VAR[agent.status];
  const isActive = agent.status === 'running';
  const isLead = agent.role === 'lead';

  const cost = agent.sessionCostUsd != null ? Number(agent.sessionCostUsd) : null;

  return (
    <button
      onClick={onSelect}
      className="w-full px-2.5 py-2 flex items-center gap-2.5 text-left rounded-sm transition-all group"
      style={{
        background: isSelected
          ? `color-mix(in srgb, ${color} 10%, transparent)`
          : 'transparent',
        borderLeft: `2px solid ${isSelected ? color : 'transparent'}`,
      }}
    >
      {/* Status dot */}
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: statusColor,
          boxShadow: isActive ? `0 0 6px ${statusColor}` : 'none',
          animation: isActive ? 'border-pulse 2s ease-in-out infinite' : 'none',
        }}
      />

      {/* Name + status line */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-xs font-mono font-bold truncate"
            style={{ color }}
          >
            {agent.name}
          </span>
          {isLead && (
            <Crown className="w-3 h-3 flex-shrink-0" style={{ color }} />
          )}
        </div>
        <span className="text-[9px] font-mono text-muted-foreground/60 truncate block">
          {agent.status === 'running'
            ? 'working...'
            : agent.status === 'deploying'
              ? 'starting...'
              : agent.status}
        </span>
      </div>

      {/* Cost */}
      {cost != null && cost > 0 && (
        <span className="text-[9px] font-mono text-muted-foreground/40 flex-shrink-0 tabular-nums">
          ${cost.toFixed(2)}
        </span>
      )}
    </button>
  );
}
