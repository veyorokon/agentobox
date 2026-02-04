'use client';

import { useState, useEffect } from 'react';
import { Monitor, MessageSquare, Cpu, HardDrive, Zap, Square } from 'lucide-react';
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
  const agents = useAgentStore((s) => s.getAgentsForBento(BENTO_ID));
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
      data-augmented-ui="tl-clip tr-2-clip-x br-clip bl-2-clip-x border"
      className="bg-card backdrop-blur"
      style={{
        '--aug-tl': '20px',
        '--aug-tr-extend2': '40px',
        '--aug-tr-height2': '8px',
        '--aug-br': '20px',
        '--aug-bl-extend2': '40px',
        '--aug-bl-height2': '8px',
        '--aug-border-all': '1px',
        '--aug-border-bg': isWorking ? 'var(--agent-border-active)' : 'var(--agent-border)',
      } as React.CSSProperties}
    >
      <div className="p-6">
        {/* Agent Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-14 h-14 flex items-center justify-center"
              style={{
                '--aug-tl': '10px',
                '--aug-br': '10px',
                '--aug-border-all': '2px',
                '--aug-border-bg': statusColor,
                background: isWorking ? 'var(--agent-glow)' : 'transparent',
              } as React.CSSProperties}
            >
              <span className="text-lg font-bold uppercase" style={{ color: statusColor }}>
                {agent.name.slice(0, 2)}
              </span>
            </div>
            <div>
              <h3 className="font-bold text-card-foreground text-lg capitalize">{agent.name}</h3>
              <StatusBadge status={agent.status} />
            </div>
          </div>
          {isWorking && (
            <div className="flex items-center gap-2 px-3 py-1 border border-agent-active/30 rounded-full">
              <div className="w-2 h-2 rounded-full bg-agent-active animate-pulse" />
              <span className="text-agent-active text-xs font-medium uppercase">Live</span>
            </div>
          )}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-3 gap-4">
          {/* VNC Preview */}
          <div
            data-augmented-ui="tl-clip br-clip"
            className="col-span-2 aspect-video bg-surface-inset flex items-center justify-center"
            style={{
              '--aug-tl': '12px',
              '--aug-br': '12px',
            } as React.CSSProperties}
          >
            <div className="text-center">
              <Monitor className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <span className="text-muted-foreground text-xs uppercase tracking-wider">VNC Stream</span>
            </div>
          </div>

          {/* Stats Column */}
          <div className="space-y-3">
            <StatWidget icon={<Cpu className="w-4 h-4" />} label="CPU" value="42%" accent={isWorking} />
            <StatWidget icon={<HardDrive className="w-4 h-4" />} label="RAM" value="1.2GB" accent={false} />
            <StatWidget icon={<Zap className="w-4 h-4" />} label="Cost" value="$0.12" accent={false} />
          </div>
        </div>

        {/* Chat/Activity */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: isWorking ? 'var(--agent-glow)' : 'var(--muted)',
                border: `1px solid ${isWorking ? 'var(--agent-border-active)' : 'var(--border)'}`,
              }}
            >
              <MessageSquare className="w-4 h-4" style={{ color: isWorking ? 'var(--agent-active)' : 'var(--muted-foreground)' }} />
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed flex-1">
              {agent.message || 'Waiting for instructions...'}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ControlButton icon="||" label="Pause" />
            <ControlButton icon={<Square className="w-3 h-3 text-destructive" />} label="Stop" />
          </div>
          <span className="text-muted-foreground text-xs font-mono">
            {agent.name.toUpperCase()}-{agent.createdAt.slice(-4).toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatWidget({ icon, label, value, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: boolean;
}) {
  return (
    <div
      data-augmented-ui="br-clip border"
      className="p-3"
      style={{
        '--aug-br': '8px',
        '--aug-border-all': '1px',
        '--aug-border-bg': accent ? 'var(--agent-border-active)' : 'var(--border)',
        background: accent ? 'var(--agent-glow)' : 'var(--border-subtle)',
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color: accent ? 'var(--agent-active)' : 'var(--muted-foreground)' }}>{icon}</span>
        <span className="text-muted-foreground text-xs uppercase">{label}</span>
      </div>
      <div className="font-bold text-foreground text-lg font-mono">{value}</div>
    </div>
  );
}

function ControlButton({ icon, label }: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      data-augmented-ui="tl-clip br-clip border"
      className="px-4 py-2 text-muted-foreground text-xs font-bold uppercase tracking-wider hover:text-foreground transition-colors"
      style={{
        '--aug-tl': '6px',
        '--aug-br': '6px',
        '--aug-border-all': '1px',
        '--aug-border-bg': 'var(--border)',
      } as React.CSSProperties}
      title={label}
    >
      {icon}
    </button>
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
