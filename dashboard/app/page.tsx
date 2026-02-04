'use client';

import { useState, useEffect } from 'react';
import { Monitor, Send, Pause, Square } from 'lucide-react';
import { useAgentStore } from '@/stores';
import type { Agent, AgentStatus } from '@/types';

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

export default function DashboardPage() {
  const agents = useAgentStore((s) => s.agents[BENTO_ID]) ?? [];
  const { theme, setTheme } = useTheme();

  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

  return (
    <div className="min-h-screen bg-background p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-12 h-12 flex items-center justify-center"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '2px',
                '--aug-border-bg': 'var(--accent)',
              } as React.CSSProperties}
            >
              <span className="text-accent font-bold text-xl">A</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">
                AgentBox
              </h1>
              <p className="text-muted-foreground text-sm">
                {agents.length} agents deployed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTheme(nextTheme)}
              data-augmented-ui="tl-clip br-clip border"
              className="px-4 py-2 text-muted-foreground text-xs font-bold uppercase tracking-wider hover:text-foreground transition-colors"
              style={{
                '--aug-tl': '6px',
                '--aug-br': '6px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
            >
              {theme}
            </button>
            <button
              data-augmented-ui="tl-clip br-clip border"
              className="px-6 py-3 text-accent-foreground font-bold text-sm uppercase tracking-wider bg-accent"
              style={{
                '--aug-tl': '10px',
                '--aug-br': '10px',
                '--aug-border-all': '2px',
                '--aug-border-bg': 'var(--accent)',
              } as React.CSSProperties}
            >
              + Deploy Agent
            </button>
          </div>
        </div>
      </header>

      {/* Agent Grid */}
      <main className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {agents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      </main>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const isWorking = agent.status === 'working';
  const statusColor = STATUS_COLOR_VAR[agent.status];

  return (
    <div
      data-augmented-ui="tl-clip br-clip border"
      className="bg-card backdrop-blur"
      style={{
        '--aug-tl': '20px',
        '--aug-br': '20px',
        '--aug-border-all': '1px',
        '--aug-border-bg': isWorking ? 'var(--agent-border-active)' : 'var(--agent-border)',
      } as React.CSSProperties}
    >
      <div className="p-5">
        {/* Header: avatar + name/status + controls */}
        <div className="flex items-center gap-3 mb-2">
          <div
            data-augmented-ui="tl-clip br-clip border"
            className="w-10 h-10 flex items-center justify-center flex-shrink-0"
            style={{
              '--aug-tl': '7px',
              '--aug-br': '7px',
              '--aug-border-all': '2px',
              '--aug-border-bg': statusColor,
              background: isWorking ? 'var(--agent-glow)' : 'transparent',
            } as React.CSSProperties}
          >
            <span className="text-sm font-bold uppercase" style={{ color: statusColor }}>
              {agent.name.slice(0, 2)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-card-foreground text-sm capitalize leading-tight">{agent.name}</h3>
            <StatusBadge status={agent.status} />
          </div>
          <div className="flex items-center gap-1.5">
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

        {/* Current activity */}
        <p className="text-muted-foreground text-xs text-center mb-3 truncate">
          {agent.message || 'Waiting for instructions...'}
        </p>

        {/* VNC Stream */}
        <div
          data-augmented-ui="tl-clip br-clip"
          className="aspect-video bg-surface-inset flex items-center justify-center"
          style={{
            '--aug-tl': '12px',
            '--aug-br': '12px',
          } as React.CSSProperties}
        >
          <div className="text-center">
            <Monitor className="w-6 h-6 text-muted-foreground mx-auto mb-1.5" />
            <span className="text-muted-foreground text-[10px] uppercase tracking-wider">VNC Stream</span>
          </div>
        </div>

        {/* Chat input */}
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            placeholder="Send a message..."
            className="flex-1 bg-surface-inset text-foreground text-sm px-3 py-2 rounded-lg border border-border placeholder:text-muted-foreground focus:outline-none focus:border-accent"
          />
          <button
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-accent transition-colors"
            title="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
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
