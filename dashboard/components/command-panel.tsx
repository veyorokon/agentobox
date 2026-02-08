'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Send, Search, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useMutation, useQuery } from 'urql';
import { toast } from 'sonner';
import { logger } from '@/lib/observability';
import { useTheme } from '@/lib/theme';
import { SEND_MESSAGE_MUTATION } from '@/lib/graphql/mutations';
import { AGENT_MESSAGES_QUERY } from '@/lib/graphql/queries';
import { useProjectsStore } from '@/stores/projects';
import { useAgentsStore } from '@/stores/agents';
import { useEventsStore } from '@/stores/events';
import { RosterBadge } from './roster-badge';
import { PanelTabs, type PanelTab } from './panel-tabs';
import { EventFeed } from './event-feed';
import { ProjectSelector } from './project-selector';
import { STATUS_COLOR_VAR } from './status-badge';
import type { Agent, AgentEvent, AgentMessage } from '@/types';

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
    const text = (activeTab === 'feed' ? feedFilter : input).trim();
    if (!text) return;

    // Check for @agent routing from any tab
    const atMatch = text.match(/^@(\S+)\s+([\s\S]+)/);
    if (atMatch) {
      const targetAgent = agents.find((a) => a.name === atMatch[1]);
      if (targetAgent) {
        setFeedFilter('');
        setInput('');
        try {
          await logger.withSpan('sendMessage', () =>
            sendMessageMut({
              input: { agentId: targetAgent.id, message: atMatch[2] },
            }).then(({ error }) => {
              if (error) throw error;
            })
          );
          switchTab(targetAgent.name);
        } catch {
          toast.error('Failed to send message');
        }
        return;
      }
    }

    // Normal send to current agent tab
    if (!selectedAgent) return;
    setInput('');
    try {
      await logger.withSpan('sendMessage', () =>
        sendMessageMut({
          input: {
            agentId: selectedAgent.id,
            message: text,
          },
        }).then(({ error }) => {
          if (error) throw error;
        })
      );
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeTab === 'feed' && !feedFilter.trim().startsWith('@')) return;
      handleSend();
    }
  };

  const inputPrefix = activeTab === 'feed' ? '/' : '>';
  const inputPlaceholder =
    activeTab === 'feed'
      ? 'Filter or @agent message...'
      : `Message ${activeTab}...`;

  const inputBorderColor =
    isAgentTab && selectedAgent
      ? STATUS_COLOR_VAR[selectedAgent.status]
      : 'var(--border)';

  const inputAccentColor =
    isAgentTab && selectedAgent
      ? STATUS_COLOR_VAR[selectedAgent.status]
      : 'var(--accent)';

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
                onClick={() => {
                  onToggle();
                  switchTab(agent.name);
                }}
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
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <RosterBadge
              key={agent.name}
              agent={agent}
              isSelected={activeTab === agent.name}
              onClick={() => switchTab(agent.name)}
            />
          ))}
          {agents.length === 0 && (
            <p className="text-muted-foreground text-xs font-mono">
              No agents deployed
            </p>
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
      <div
        key={activeTab}
        className="flex-1 overflow-y-auto scrollbar-thin"
        style={{ animation: 'panel-fade 0.15s ease-out' }}
      >
        {activeTab === 'feed' && (
          <EventFeed
            filter={feedFilter}
            onSelectAgent={switchTab}
          />
        )}
        {isAgentTab && selectedAgent && (
          <ChatView agent={selectedAgent} events={events} />
        )}
      </div>

      {/* Input Bar */}
      <div className="px-5 pb-5 pt-2">
        {/* Context label for agent tab */}
        {isAgentTab && selectedAgent && (
          <div className="flex items-center gap-2 mb-1.5 px-1">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background: STATUS_COLOR_VAR[selectedAgent.status],
                boxShadow:
                  selectedAgent.status === 'running'
                    ? `0 0 4px ${STATUS_COLOR_VAR[selectedAgent.status]}`
                    : 'none',
              }}
            />
            <span
              className="text-[9px] font-mono font-bold uppercase tracking-wider"
              style={{ color: STATUS_COLOR_VAR[selectedAgent.status] }}
            >
              {selectedAgent.name} — {selectedAgent.status}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div
            data-augmented-ui="tl-clip br-clip border"
            className="flex-1"
            style={{
              '--aug-tl': '8px',
              '--aug-br': '8px',
              '--aug-border-all': '1px',
              '--aug-border-bg': inputBorderColor,
            } as React.CSSProperties}
          >
            <div className="flex items-center">
              <span
                className="font-mono text-sm pl-3 select-none font-bold"
                style={{ color: inputAccentColor }}
              >
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
          {activeTab !== 'feed' || feedFilter.trim().startsWith('@') ? (
            <button
              onClick={handleSend}
              data-augmented-ui="tl-clip br-clip border"
              className="w-9 h-9 flex items-center justify-center transition-colors"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': inputBorderColor,
                color: inputAccentColor,
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


function ChatView({ agent, events }: { agent: Agent; events: AgentEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const processedRef = useRef<Set<number | string>>(new Set());

  // Fetch messages from backend
  const [{ data }] = useQuery({
    query: AGENT_MESSAGES_QUERY,
    variables: { agentId: agent.id },
  });

  // Sync query results
  useEffect(() => {
    if (data?.agent?.messages) {
      setMessages(data.agent.messages);
    }
  }, [data]);

  // Pick up new messages from event stream.
  // FIX: Scan ALL new events instead of only checking events[events.length - 1].
  // The old approach missed outbound_message events whenever a subsequent event
  // (e.g. a Stop or PostToolUse) arrived before React re-rendered.
  useEffect(() => {
    const newMsgs: AgentMessage[] = [];

    for (const evt of events) {
      if (processedRef.current.has(evt.id)) continue;
      processedRef.current.add(evt.id);

      if (evt.agentId !== agent.id) continue;
      if (
        evt.eventType !== 'inbound_message' &&
        evt.eventType !== 'outbound_message'
      )
        continue;

      const msg = evt.data as { message?: string };
      if (!msg.message) continue;

      newMsgs.push({
        id: `evt-${evt.id}`,
        direction:
          evt.eventType === 'inbound_message' ? 'inbound' : 'outbound',
        content: msg.message,
        createdAt: evt.createdAt || new Date().toISOString(),
      });
    }

    if (newMsgs.length > 0) {
      setMessages((prev) => {
        const seen = new Set(
          prev.map((m) => `${m.direction}:${m.content}`)
        );
        const unique = newMsgs.filter(
          (m) => !seen.has(`${m.direction}:${m.content}`)
        );
        return unique.length > 0 ? [...prev, ...unique] : prev;
      });
    }
  }, [events, agent.id]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  const statusColor = STATUS_COLOR_VAR[agent.status];
  const isWaiting =
    messages.length > 0 &&
    messages[messages.length - 1].direction === 'inbound' &&
    (agent.status === 'running' || agent.status === 'deploying');

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 py-12">
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="w-14 h-14 flex items-center justify-center"
          style={{
            '--aug-tl': '9px',
            '--aug-br': '9px',
            '--aug-border-all': '1.5px',
            '--aug-border-bg': statusColor,
          } as React.CSSProperties}
        >
          <span
            className="text-base font-bold font-mono uppercase"
            style={{ color: statusColor }}
          >
            {agent.name.slice(0, 2)}
          </span>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground text-xs font-mono">
            {agent.name}
            <span className="empty-cursor" />
          </p>
          <p className="text-muted-foreground/50 text-[10px] font-mono mt-1.5">
            Send a task to begin
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="px-4 py-3 space-y-3">
      {messages.map((msg) => {
        const isInbound = msg.direction === 'inbound';
        const time = new Date(msg.createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div
            key={msg.id}
            className={`flex ${isInbound ? 'justify-end' : 'justify-start'}`}
            style={{
              animation:
                'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div className="max-w-[88%]">
              {/* Header: sender + time */}
              <div
                className={`flex items-center gap-2 mb-1 ${
                  isInbound ? 'justify-end' : 'justify-start'
                }`}
              >
                <span
                  className="text-[9px] font-mono font-bold uppercase tracking-wider"
                  style={{
                    color: isInbound ? 'var(--accent)' : statusColor,
                  }}
                >
                  {isInbound ? 'you' : agent.name}
                </span>
                <span className="text-muted-foreground/40 text-[9px] font-mono tabular-nums">
                  {time}
                </span>
              </div>

              {/* Message bubble */}
              <div
                data-augmented-ui="tl-clip br-clip border"
                className={`px-3 py-2.5 ${
                  isInbound ? 'bg-accent/10' : 'bg-card'
                }`}
                style={{
                  '--aug-tl': '6px',
                  '--aug-br': '6px',
                  '--aug-border-all': '1px',
                  '--aug-border-bg': isInbound
                    ? 'var(--accent)'
                    : statusColor,
                } as React.CSSProperties}
              >
                <p className="text-foreground text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {msg.content}
                </p>
              </div>
            </div>
          </div>
        );
      })}

      {/* Waiting indicator — shown when agent is processing */}
      {isWaiting && (
        <div
          className="flex justify-start"
          style={{
            animation:
              'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[9px] font-mono font-bold uppercase tracking-wider"
                style={{ color: statusColor }}
              >
                {agent.name}
              </span>
            </div>
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="px-4 py-3 bg-card"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': statusColor,
              } as React.CSSProperties}
            >
              <div className="flex gap-1.5">
                {[0, 1, 2].map((dotIdx) => (
                  <span
                    key={dotIdx}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: statusColor,
                      animation:
                        'waiting-blink 1.4s ease-in-out infinite',
                      animationDelay: `${dotIdx * 0.2}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
