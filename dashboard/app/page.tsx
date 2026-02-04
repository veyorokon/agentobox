'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Monitor, Send, Pause, Square } from 'lucide-react';
import { useAgentStore, useChatStore } from '@/stores';
import type { Agent, AgentStatus, ChatMessage } from '@/types';

const BENTO_ID = 'bento-1';
const THEMES = ['cyberpunk', 'retro'] as const;
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
  const agents = useAgentStore((s) => s.agents[BENTO_ID]) ?? [];
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

function CommandPanel({
  agents,
  theme,
  onThemeToggle,
}: {
  agents: Agent[];
  theme: Theme;
  onThemeToggle: () => void;
}) {
  const messages = useChatStore((s) => s.messages[BENTO_ID]) ?? [];
  const addMessage = useChatStore((s) => s.addMessage);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    addMessage(BENTO_ID, { role: 'user', content: text });
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
              AgentBox
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
            <RosterBadge key={agent.name} agent={agent} />
          ))}
          {agents.length === 0 && (
            <p className="text-muted-foreground text-xs">No agents deployed</p>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 border-t" style={{ borderColor: 'var(--border)' }} />

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center h-full">
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

      {/* Chat Input */}
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
              <span className="text-accent font-mono text-sm pl-3 select-none">&gt;</span>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message agento..."
                className="w-full bg-transparent text-foreground font-mono text-sm px-2 py-2.5 placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>
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
        </div>
      </div>
    </aside>
  );
}

/* ================================================================
   Roster badge (compact agent status in command panel)
   ================================================================ */

function RosterBadge({ agent }: { agent: Agent }) {
  const color = STATUS_COLOR_VAR[agent.status];

  return (
    <div className="flex items-center gap-1.5 py-0.5">
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
    </div>
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
          <p className="flex-1 text-muted-foreground text-xs text-center truncate">
            {agent.message || 'Waiting for instructions...'}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
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
          {agent.vncUrl ? (
            <VncFrame url={agent.vncUrl} />
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

function VncFrame({ url }: { url: string }) {
  const [retryKey, setRetryKey] = useState(0);

  const handleError = useCallback(() => {
    setTimeout(() => setRetryKey((k) => k + 1), 3000);
  }, []);

  return (
    <iframe
      key={retryKey}
      src={`${url}/?autoconnect=1&resize=scale&password=password`}
      className="w-full h-full border-0"
      allow="clipboard-read; clipboard-write"
      onError={handleError}
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
