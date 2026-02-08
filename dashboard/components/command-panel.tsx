'use client';

import { useState, useCallback, useMemo } from 'react';
import { Send, Search, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useMutation } from 'urql';
import { toast } from 'sonner';
import { logger } from '@/lib/observability';
import { useTheme } from '@/lib/theme';
import { SEND_MESSAGE_MUTATION } from '@/lib/graphql/mutations';
import { useProjectsStore } from '@/stores/projects';
import { useAgentsStore } from '@/stores/agents';
import { useEventsStore } from '@/stores/events';
import { RosterBadge } from './roster-badge';
import { PanelTabs, type PanelTab } from './panel-tabs';
import { EventFeed } from './event-feed';
import { ProjectSelector } from './project-selector';
import { STATUS_COLOR_VAR } from './status-badge';
import type { Agent, AgentEvent } from '@/types';

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_EVENTS: AgentEvent[] = [];

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
  const events = useEventsStore((s) =>
    projectId ? (s.events[projectId] ?? EMPTY_EVENTS) : EMPTY_EVENTS
  );

  const [activeTab, setActiveTab] = useState<PanelTab>('feed');
  const [input, setInput] = useState('');
  const [feedFilter, setFeedFilter] = useState('');
  const [, sendMessageMut] = useMutation(SEND_MESSAGE_MUTATION);

  const switchTab = useCallback((tab: PanelTab) => {
    setActiveTab(tab);
    setInput('');
    setFeedFilter('');
  }, []);

  const isAgentTab = activeTab !== 'feed';
  const selectedAgent = isAgentTab
    ? agents.find((a) => a.name === activeTab)
    : null;

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    try {
      await logger.withSpan('sendMessage', () =>
        sendMessageMut({
          input: {
            agentId: selectedAgent?.id ?? '',
            message: text,
          },
        }).then(({ error }) => {
          if (error) throw error;
        })
      );
    } catch (err) {
      toast.error('Failed to send message');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeTab === 'feed') return;
      handleSend();
    }
  };

  const inputPrefix = activeTab === 'feed' ? '/' : '>';
  const inputPlaceholder =
    activeTab === 'feed'
      ? 'Filter events...'
      : `Message ${activeTab}...`;

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

      {/* Agent Roster */}
      <div className="px-5 pb-3">
        <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider mb-2">
          Agents
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {agents.map((agent) => (
            <RosterBadge
              key={agent.name}
              agent={agent}
              isSelected={activeTab === agent.name}
              onClick={() => switchTab(agent.name)}
            />
          ))}
          {agents.length === 0 && (
            <p className="text-muted-foreground text-xs">No agents deployed</p>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <PanelTabs
        active={activeTab}
        selectedAgent={selectedAgent}
        onSelect={switchTab}
      />

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {activeTab === 'feed' && (
          <EventFeed
            filter={feedFilter}
            onSelectAgent={switchTab}
          />
        )}
        {isAgentTab && (
          <div className="px-5 py-4">
            <div className="flex-1 flex items-center justify-center h-32">
              <p className="text-muted-foreground text-xs text-center leading-relaxed">
                Direct messaging coming soon.
                <br />
                <span className="text-[10px]">Agent: {activeTab}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="px-5 pb-5 pt-2">
        <div className="flex items-center gap-2">
          <div
            data-augmented-ui="tl-clip br-clip border"
            className="flex-1"
            style={{
              '--aug-tl': '8px',
              '--aug-br': '8px',
              '--aug-border-all': '1px',
              '--aug-border-bg': 'var(--border)',
            } as React.CSSProperties}
          >
            <div className="flex items-center">
              <span className="text-accent font-mono text-sm pl-3 select-none">
                {inputPrefix}
              </span>
              <input
                type="text"
                value={activeTab === 'feed' ? feedFilter : input}
                onChange={(e) =>
                  activeTab === 'feed'
                    ? setFeedFilter(e.target.value)
                    : setInput(e.target.value)
                }
                onKeyDown={handleKeyDown}
                placeholder={inputPlaceholder}
                className="w-full bg-transparent text-foreground font-mono text-sm px-2 py-2.5 placeholder:text-muted-foreground placeholder:select-none focus:outline-none selection:bg-accent/20 selection:text-foreground"
              />
            </div>
          </div>
          {activeTab !== 'feed' ? (
            <button
              onClick={handleSend}
              data-augmented-ui="tl-clip br-clip border"
              className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-accent transition-colors"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
              title="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          ) : (
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-9 h-9 flex items-center justify-center text-muted-foreground"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              <Search className="w-4 h-4" />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
