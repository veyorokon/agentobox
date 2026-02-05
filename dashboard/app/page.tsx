'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Monitor, Send, Pause, Square, Search, RefreshCw } from 'lucide-react';
import { useAgentStore, useChatStore, useEventStore } from '@/stores';
import { API_V1 } from '@/lib/constants';
import type { Agent, AgentStatus, AgentEvent, ChatMessage } from '@/types';

const PROJECT_ID = 'project-1';
const THEMES = ['cyberpunk', 'retro', 'rose-pine'] as const;
type Theme = typeof THEMES[number];

const STATUS_COLOR_VAR: Record<AgentStatus, string> = {
  idle: 'var(--agent-idle)',
  working: 'var(--agent-active)',
  completed: 'var(--agent-completed)',
  blocked: 'var(--agent-blocked)',
  dead: 'var(--agent-dead)',
};

function useTheme() {
  const [theme, setThemeState] = useState<Theme>('cyberpunk');

  useEffect(() => {
    const saved = localStorage.getItem('agentbox-theme') as Theme | null;
    if (saved && THEMES.includes(saved)) {
      setThemeState(saved);
      document.documentElement.setAttribute('data-theme', saved);
    }
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('agentbox-theme', t);
  };

  return { theme, setTheme };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/* ================================================================
   Page
   ================================================================ */

export default function DashboardPage() {
  const agents = useAgentStore((s) => s.agents[PROJECT_ID]) ?? [];
  const { theme, setTheme } = useTheme();
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Left: Command Panel */}
      <CommandPanel
        agents={agents}
        theme={theme}
        onThemeToggle={() => setTheme(nextTheme)}
      />

      {/* Right: Agent Grid */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <p className="text-muted-foreground text-sm font-mono">
            {agents.length} agents deployed
          </p>
          <button
            data-augmented-ui="tl-clip br-clip border"
            className="px-5 py-2.5 text-accent-foreground font-bold text-xs uppercase tracking-wider bg-accent"
            style={{
              '--aug-tl': '8px',
              '--aug-br': '8px',
              '--aug-border-all': '2px',
              '--aug-border-bg': 'var(--accent)',
            } as React.CSSProperties}
          >
            + Deploy Agent
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 pb-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {agents.map((agent) => (
              <AgentCard key={agent.name} agent={agent} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ================================================================
   Command Panel (left sidebar)
   ================================================================ */

type PanelTab = 'agento' | 'feed' | (string & {});

function CommandPanel({
  agents,
  theme,
  onThemeToggle,
}: {
  agents: Agent[];
  theme: Theme;
  onThemeToggle: () => void;
}) {
  const messages = useChatStore((s) => s.messages[PROJECT_ID]) ?? [];

  const [activeTab, setActiveTab] = useState<PanelTab>('agento');
  const [input, setInput] = useState('');
  const [feedFilter, setFeedFilter] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Clear input when switching tabs
  const switchTab = useCallback((tab: PanelTab) => {
    setActiveTab(tab);
    setInput('');
    setFeedFilter('');
  }, []);

  useEffect(() => {
    if (activeTab === 'agento') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, activeTab]);

  const isAgentTab = activeTab !== 'agento' && activeTab !== 'feed';
  const selectedAgent = isAgentTab ? agents.find(a => a.name === activeTab) : null;

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    const target = activeTab === 'agento' ? 'agento' : activeTab;
    setInput('');
    try {
      await fetch(`${API_V1}/projects/${PROJECT_ID}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, content: text }),
      });
    } catch { /* poller picks up server state */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeTab === 'feed') return; // feed uses filter, no send
      handleSend();
    }
  };

  const inputPrefix = activeTab === 'feed' ? '/' : '>';
  const inputPlaceholder = activeTab === 'feed'
    ? 'Filter events...'
    : activeTab === 'agento'
      ? 'Message agento...'
      : `Message ${activeTab}...`;

  return (
    <aside
      className="w-[380px] flex-shrink-0 flex flex-col bg-surface"
      style={{ borderRight: '1px solid var(--border)' }}
    >
      {/* Panel Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
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
          <button
            onClick={onThemeToggle}
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
        </div>
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
        {activeTab === 'agento' && (
          <div className="px-5 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center h-32">
                <p className="text-muted-foreground text-xs text-center leading-relaxed">
                  Send a message to start<br />orchestrating your agents
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
        {activeTab === 'feed' && (
          <EventFeed filter={feedFilter} onSelectAgent={switchTab} />
        )}
        {isAgentTab && (
          <div className="px-5 py-4">
            <div className="flex-1 flex items-center justify-center h-32">
              <p className="text-muted-foreground text-xs text-center leading-relaxed">
                Direct messaging coming soon.<br />
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
              <span className="text-accent font-mono text-sm pl-3 select-none">{inputPrefix}</span>
              <input
                type="text"
                value={activeTab === 'feed' ? feedFilter : input}
                onChange={(e) => activeTab === 'feed' ? setFeedFilter(e.target.value) : setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={inputPlaceholder}
                className="w-full bg-transparent text-foreground font-mono text-sm px-2 py-2.5 placeholder:text-muted-foreground focus:outline-none"
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

/* ================================================================
   Panel Tabs
   ================================================================ */

function PanelTabs({
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
      <button className={tabClass('agento')} onClick={() => onSelect('agento')}>
        <span style={active === 'agento' ? { borderBottom: '2px solid var(--accent)', paddingBottom: '6px' } : undefined}>
          Agento
        </span>
      </button>
      <button className={tabClass('feed')} onClick={() => onSelect('feed')}>
        <span style={active === 'feed' ? { borderBottom: '2px solid var(--accent)', paddingBottom: '6px' } : undefined}>
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
              color: active === selectedAgent.name ? STATUS_COLOR_VAR[selectedAgent.status] : undefined,
              borderBottom: active === selectedAgent.name ? `2px solid ${STATUS_COLOR_VAR[selectedAgent.status]}` : undefined,
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

/* ================================================================
   Event Feed (live log stream)
   ================================================================ */

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

const STATE_SYMBOLS: Record<AgentStatus, string> = {
  idle: '\u25CB',      // ○
  working: '\u25CF',   // ●
  completed: '\u2713', // ✓
  blocked: '\u26A0',   // ⚠
  dead: '\u2717',      // ✗
};

function EventFeed({ filter, onSelectAgent }: { filter: string; onSelectAgent: (name: string) => void }) {
  const events = useEventStore((s) => s.events[PROJECT_ID]) ?? [];
  const feedRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  // Auto-scroll unless user scrolled up
  useEffect(() => {
    if (!userScrolled && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events.length, userScrolled]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setUserScrolled(!atBottom);
  };

  const filtered = filter
    ? events.filter(e =>
        e.agent.toLowerCase().includes(filter.toLowerCase()) ||
        e.msg.toLowerCase().includes(filter.toLowerCase()) ||
        e.state.toLowerCase().includes(filter.toLowerCase())
      )
    : events;

  // Show newest last (chronological)
  const sorted = [...filtered].sort((a, b) => a.ts.localeCompare(b.ts));

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-muted-foreground text-xs text-center">
          {filter ? 'No matching events' : 'No events yet'}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={feedRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto scrollbar-thin"
    >
      {sorted.map((event, i) => (
        <div
          key={`${event.ts}-${event.agent}-${i}`}
          className="flex items-start gap-2 px-5 py-1.5 hover:bg-surface-inset/50 transition-colors group"
        >
          <span className="text-muted-foreground text-[10px] font-mono w-14 flex-shrink-0 pt-px">
            {formatEventTime(event.ts)}
          </span>
          <button
            onClick={() => onSelectAgent(event.agent)}
            className="text-[11px] font-mono font-bold w-16 flex-shrink-0 truncate text-left hover:underline pt-px"
            style={{ color: STATUS_COLOR_VAR[event.state] }}
          >
            {event.agent}
          </button>
          <span
            className="text-[11px] flex-shrink-0 pt-px"
            style={{ color: STATUS_COLOR_VAR[event.state] }}
            title={event.state}
          >
            {STATE_SYMBOLS[event.state]}
          </span>
          <span className="text-foreground text-xs font-mono truncate pt-px">
            {event.msg || event.state}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ================================================================
   Roster badge (compact agent status in command panel)
   ================================================================ */

function RosterBadge({ agent, isSelected, onClick }: { agent: Agent; isSelected: boolean; onClick: () => void }) {
  const color = STATUS_COLOR_VAR[agent.status];

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 py-0.5 hover:opacity-80 transition-opacity"
      style={isSelected ? { textDecoration: 'underline', textUnderlineOffset: '2px' } : undefined}
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

/* ================================================================
   Chat bubble
   ================================================================ */

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div
          data-augmented-ui="tl-clip bl-clip border"
          className="max-w-[85%] px-3 py-2"
          style={{
            '--aug-tl': '8px',
            '--aug-bl': '8px',
            '--aug-border-all': '1px',
            '--aug-border-bg': 'var(--accent)',
            background: 'var(--agent-glow)',
          } as React.CSSProperties}
        >
          <p className="text-foreground text-sm leading-relaxed">{message.content}</p>
        </div>
        <span className="text-muted-foreground text-[10px] font-mono mr-1">
          {timeAgo(message.ts)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        data-augmented-ui="tr-clip br-clip border"
        className="max-w-[85%] px-3 py-2"
        style={{
          '--aug-tr': '8px',
          '--aug-br': '8px',
          '--aug-border-all': '1px',
          '--aug-border-bg': 'var(--border)',
        } as React.CSSProperties}
      >
        <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1">
          agento
        </p>
        <p className="text-foreground text-sm leading-relaxed">{message.content}</p>
      </div>
      <span className="text-muted-foreground text-[10px] font-mono ml-1">
        {timeAgo(message.ts)}
      </span>
    </div>
  );
}

/* ================================================================
   Agent Card (right panel)
   ================================================================ */

function AgentCard({ agent }: { agent: Agent }) {
  const isWorking = agent.status === 'working';
  const statusColor = STATUS_COLOR_VAR[agent.status];
  const vncRefreshRef = useRef<(() => void) | null>(null);

  return (
    <div
      data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
      className="bg-card backdrop-blur overflow-hidden"
      style={{
        '--aug-tl': '20px',
        '--aug-tr': '20px',
        '--aug-br': '20px',
        '--aug-bl': '20px',
        '--aug-border-all': '1px',
        '--aug-border-bg': isWorking ? 'var(--agent-border-active)' : 'var(--agent-border)',
      } as React.CSSProperties}
    >
      <div className="p-5">
        {/* Header: avatar + name/status + activity + controls */}
        <div className="flex items-center gap-3 mb-3">
          <div
            data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
            className="w-10 h-10 flex items-center justify-center flex-shrink-0"
            style={{
              '--aug-tl': '7px',
              '--aug-tr': '7px',
              '--aug-br': '7px',
              '--aug-bl': '7px',
              '--aug-border-all': '2px',
              '--aug-border-bg': statusColor,
              background: isWorking ? 'var(--agent-glow)' : 'transparent',
            } as React.CSSProperties}
          >
            <span className="text-sm font-bold uppercase" style={{ color: statusColor }}>
              {agent.name.slice(0, 2)}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-card-foreground text-sm capitalize leading-tight">{agent.name}</h3>
            <StatusBadge status={agent.status} />
          </div>
          <div className="flex-1 min-w-0 text-center">
            {agent.task && (
              <p className="text-card-foreground text-xs truncate">{agent.task}</p>
            )}
            <p className="text-muted-foreground text-[10px] truncate">
              {agent.message || (agent.task ? '' : 'Waiting for instructions...')}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => vncRefreshRef.current?.()}
              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh VNC"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Pause"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center text-destructive/60 hover:text-destructive transition-colors"
              title="Stop"
            >
              <Square className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* VNC Stream */}
        <div className="aspect-[4/3] bg-surface-inset overflow-hidden">
          {agent.vncUrl && agent.status !== 'dead' ? (
            <VncFrame url={agent.vncUrl} onRefresh={(fn) => { vncRefreshRef.current = fn; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <Monitor className="w-6 h-6 text-muted-foreground mx-auto mb-1.5" />
                <span className="text-muted-foreground text-[10px] uppercase tracking-wider">VNC Stream</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Supporting components
   ================================================================ */

function VncFrame({ url, onRefresh }: { url: string; onRefresh?: (refresh: () => void) => void }) {
  const [connected, setConnected] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Expose refresh callback to parent
  useEffect(() => {
    onRefresh?.(() => setRetryKey(k => k + 1));
  }, [onRefresh]);

  // Poll VNC server until reachable, then render iframe
  useEffect(() => {
    setConnected(false);
    let cancelled = false;
    const check = async () => {
      try {
        await fetch(url, { mode: 'no-cors' });
        if (!cancelled) setConnected(true);
      } catch {
        if (!cancelled) setTimeout(check, 3000);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [url, retryKey]);

  if (!connected) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Connecting to VNC...
      </div>
    );
  }

  return (
    <iframe
      src={`${url}/?autoconnect=1&resize=scale&password=password`}
      className="w-full h-full border-0"
      allow="clipboard-read; clipboard-write"
      onError={() => { setConnected(false); }}
    />
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const labels: Record<AgentStatus, string> = {
    idle: 'Idle',
    working: 'Working',
    completed: 'Completed',
    blocked: 'Blocked',
    dead: 'Dead',
  };

  return (
    <span
      className="text-xs font-semibold uppercase tracking-wide"
      style={{ color: STATUS_COLOR_VAR[status] }}
    >
      {labels[status]}
    </span>
  );
}
