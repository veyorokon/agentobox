'use client';

import { useMemo } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useProjectsStore } from '@/stores/projects';
import { useAgentsStore } from '@/stores/agents';
import { useMessagesStore } from '@/stores/messages';
import { ProjectSelector } from './project-selector';
import { STATUS_COLOR_VAR } from './status-badge';
import { ChatView } from './chat-view';
import { MessageComposer } from './message-composer';
import { AgentListItem } from './agent-list-item';
import type { Agent, Message } from '@/types';

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_MESSAGES: Record<string, Message> = {};

export function CommandPanel({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { theme, setTheme, themes } = useTheme();
  const nextTheme = themes[(themes.indexOf(theme) + 1) % themes.length];

  const projectId = useProjectsStore((s) => s.currentProjectId);
  const allAgents = useAgentsStore((s) =>
    projectId ? (s.agents[projectId] ?? EMPTY_AGENTS) : EMPTY_AGENTS
  );
  const agents = useMemo(
    () => allAgents.filter((a) => a.status !== 'stopped'),
    [allAgents]
  );
  const agentMessages = useMessagesStore((s) => s.byAgent);
  const setSelectedAgent = useAgentsStore((s) => s.setSelectedAgent);

  // Split agents by role
  const teamLead = useMemo(
    () => agents.find((a) => a.role === 'lead'),
    [agents]
  );
  const workers = useMemo(
    () => agents.filter((a) => a.role !== 'lead'),
    [agents]
  );

  if (collapsed) {
    return (
      <aside
        className="w-14 flex-shrink-0 flex flex-col items-center bg-surface py-4 gap-3 transition-all duration-200"
        style={{ borderRight: '1px solid var(--border)' }}
      >
        {/* Logo */}
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="w-9 h-9 flex items-center justify-center flex-shrink-0"
          style={{
            '--aug-tl': '6px',
            '--aug-br': '6px',
            '--aug-border-all': '2px',
            '--aug-border-bg': 'var(--accent)',
          } as React.CSSProperties}
        >
          <span className="text-accent font-bold text-sm">A</span>
        </div>

        {/* Divider */}
        <div className="w-6 h-px bg-border" />

        {/* Agent avatars */}
        <div className="flex-1 flex flex-col items-center gap-2 overflow-y-auto scrollbar-thin">
          {agents.map((agent) => {
            const color = STATUS_COLOR_VAR[agent.status];
            const isWorking = agent.status === 'running';
            return (
              <button
                key={agent.name}
                title={`${agent.name} — ${agent.status}`}
                onClick={onToggle}
                data-augmented-ui="tl-clip br-clip border"
                className="w-9 h-9 flex items-center justify-center flex-shrink-0"
                style={{
                  '--aug-tl': '6px',
                  '--aug-br': '6px',
                  '--aug-border-all': '1.5px',
                  '--aug-border-bg': color,
                  background: isWorking ? 'var(--agent-glow)' : 'transparent',
                } as React.CSSProperties}
              >
                <span
                  className="text-[10px] font-bold uppercase"
                  style={{ color }}
                >
                  {agent.name.slice(0, 2)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Expand toggle */}
        <button
          onClick={onToggle}
          className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          title="Expand sidebar (⌘B)"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="w-[380px] flex-shrink-0 flex flex-col bg-surface transition-all duration-200"
      style={{ borderRight: '1px solid var(--border)' }}
    >
      {/* Panel Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-10 h-10 flex items-center justify-center"
              style={{
                '--aug-tl': '7px',
                '--aug-br': '7px',
                '--aug-border-all': '2px',
                '--aug-border-bg': 'var(--accent)',
              } as React.CSSProperties}
            >
              <span className="text-accent font-bold text-lg">A</span>
            </div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">
              agentobox
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(nextTheme)}
              data-augmented-ui="tl-clip br-clip border"
              className="px-3 py-1.5 text-muted-foreground text-[10px] font-bold uppercase tracking-wider hover:text-foreground transition-colors"
              style={{
                '--aug-tl': '5px',
                '--aug-br': '5px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              {theme}
            </button>
            <button
              onClick={onToggle}
              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse sidebar (⌘B)"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
        <ProjectSelector />
      </div>

      {/* Vertical split: Top 40% = Team Lead, Bottom 60% = Workers */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Top pane: Team Lead Chat (40%) */}
        <div
          className="flex flex-col"
          style={{
            height: '40%',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="px-5 pb-2">
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
              Team Lead
            </p>
          </div>
          {teamLead ? (
            <>
              <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin flex flex-col-reverse">
                <ChatView
                  agent={teamLead}
                  messages={agentMessages[teamLead.id] ?? EMPTY_MESSAGES}
                />
              </div>
              <MessageComposer agent={teamLead} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center px-5 py-8">
              <p className="text-muted-foreground/40 text-xs font-mono text-center">
                No team lead deployed
              </p>
            </div>
          )}
        </div>

        {/* Bottom pane: Workers List (60%) */}
        <div className="flex flex-col" style={{ height: '60%' }}>
          <div className="px-5 py-3">
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
              Workers
            </p>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin px-5 pb-5">
            {workers.length > 0 ? (
              <div className="space-y-2">
                {workers.map((agent) => (
                  <AgentListItem
                    key={agent.id}
                    agent={agent}
                    onClick={() => setSelectedAgent(agent.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground/40 text-xs font-mono text-center">
                  No workers deployed
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
