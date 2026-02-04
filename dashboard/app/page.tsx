'use client';

import { Activity, Monitor, MessageSquare, Cpu, HardDrive, Zap, Square } from 'lucide-react';
import { mockAgents } from '@/lib/mock-data';
import type { Agent, AgentStatus } from '@/types';

// Get all agents from first bento for demo
const agents = mockAgents['bento-1'];

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-black p-8">
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
                '--aug-border-bg': '#39ff14',
              } as React.CSSProperties}
            >
              <span className="text-[#39ff14] font-bold text-xl">A</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                AgentBox
              </h1>
              <p className="text-white/40 text-sm">
                4 agents deployed
              </p>
            </div>
          </div>
          <button
            data-augmented-ui="tl-clip br-clip border"
            className="px-6 py-3 text-black font-bold text-sm uppercase tracking-wider"
            style={{
              '--aug-tl': '10px',
              '--aug-br': '10px',
              '--aug-border-all': '2px',
              '--aug-border-bg': '#39ff14',
              background: '#39ff14',
            } as React.CSSProperties}
          >
            + Deploy Agent
          </button>
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
  const accentColor = isWorking ? '#39ff14' : '#ffffff';

  return (
    <div
      data-augmented-ui="tl-clip tr-2-clip-x br-clip bl-2-clip-x border"
      className="bg-black/50 backdrop-blur"
      style={{
        '--aug-tl': '20px',
        '--aug-tr-extend2': '40px',
        '--aug-tr-height2': '8px',
        '--aug-br': '20px',
        '--aug-bl-extend2': '40px',
        '--aug-bl-height2': '8px',
        '--aug-border-all': '1px',
        '--aug-border-bg': isWorking ? '#39ff14' : 'rgba(255,255,255,0.2)',
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
                '--aug-border-bg': accentColor,
                background: isWorking ? 'rgba(57, 255, 20, 0.1)' : 'transparent',
              } as React.CSSProperties}
            >
              <span className="text-lg font-bold uppercase" style={{ color: accentColor }}>
                {agent.name.slice(0, 2)}
              </span>
            </div>
            <div>
              <h3 className="font-bold text-white text-lg capitalize">{agent.name}</h3>
              <StatusBadge status={agent.status} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isWorking && (
              <div className="flex items-center gap-2 px-3 py-1 border border-[#39ff14]/30 rounded-full">
                <div className="w-2 h-2 rounded-full bg-[#39ff14] animate-pulse" />
                <span className="text-[#39ff14] text-xs font-medium uppercase">Live</span>
              </div>
            )}
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-3 gap-4">
          {/* VNC Preview - spans 2 columns */}
          <div
            data-augmented-ui="tl-clip br-clip border"
            className="col-span-2 aspect-video bg-[#0a0a0a] flex items-center justify-center"
            style={{
              '--aug-tl': '12px',
              '--aug-br': '12px',
              '--aug-border-all': '1px',
              '--aug-border-bg': 'rgba(255,255,255,0.1)',
            } as React.CSSProperties}
          >
            <div className="text-center">
              <Monitor className="w-8 h-8 text-white/20 mx-auto mb-2" />
              <span className="text-white/30 text-xs uppercase tracking-wider">VNC Stream</span>
            </div>
          </div>

          {/* Stats Column */}
          <div className="space-y-3">
            <StatWidget
              icon={<Cpu className="w-4 h-4" />}
              label="CPU"
              value="42%"
              accent={isWorking}
            />
            <StatWidget
              icon={<HardDrive className="w-4 h-4" />}
              label="RAM"
              value="1.2GB"
              accent={false}
            />
            <StatWidget
              icon={<Zap className="w-4 h-4" />}
              label="Cost"
              value="$0.12"
              accent={false}
            />
          </div>
        </div>

        {/* Chat/Activity Section */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: isWorking ? 'rgba(57, 255, 20, 0.2)' : 'rgba(255,255,255,0.1)',
                border: `1px solid ${isWorking ? '#39ff14' : 'rgba(255,255,255,0.2)'}`
              }}
            >
              <MessageSquare className="w-4 h-4" style={{ color: accentColor }} />
            </div>
            <div className="flex-1">
              <p className="text-white/70 text-sm leading-relaxed">
                {agent.message || 'Waiting for instructions...'}
              </p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ControlButton icon="||" label="Pause" />
            <ControlButton icon={<Square className="w-3 h-3" />} label="Stop" danger />
          </div>
          <div className="text-white/30 text-xs font-mono">
            {agent.name.toUpperCase()}-{Math.random().toString(36).slice(2, 6).toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatWidget({
  icon,
  label,
  value,
  accent
}: {
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
        '--aug-border-bg': accent ? '#39ff14' : 'rgba(255,255,255,0.1)',
        background: accent ? 'rgba(57, 255, 20, 0.05)' : 'rgba(255,255,255,0.02)',
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color: accent ? '#39ff14' : 'rgba(255,255,255,0.4)' }}>{icon}</span>
        <span className="text-white/40 text-xs uppercase">{label}</span>
      </div>
      <div className="font-bold text-white text-lg font-mono">{value}</div>
    </div>
  );
}

function ControlButton({
  icon,
  label,
  danger = false
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  const borderColor = danger ? '#ff4444' : 'rgba(255,255,255,0.2)';
  const hoverBg = danger ? 'rgba(255,68,68,0.1)' : 'rgba(255,255,255,0.05)';

  return (
    <button
      data-augmented-ui="tl-clip br-clip border"
      className="px-4 py-2 text-white/60 text-xs font-bold uppercase tracking-wider hover:text-white transition-colors"
      style={{
        '--aug-tl': '6px',
        '--aug-br': '6px',
        '--aug-border-all': '1px',
        '--aug-border-bg': borderColor,
      } as React.CSSProperties}
      title={label}
    >
      {icon}
    </button>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const config: Record<AgentStatus, { color: string; label: string }> = {
    idle: { color: '#6b7280', label: 'Idle' },
    working: { color: '#39ff14', label: 'Working' },
    completed: { color: '#22c55e', label: 'Completed' },
    blocked: { color: '#f59e0b', label: 'Blocked' },
    dead: { color: '#ef4444', label: 'Dead' },
  };

  const { color, label } = config[status];

  return (
    <span
      className="text-xs font-semibold uppercase tracking-wide"
      style={{ color }}
    >
      {label}
    </span>
  );
}
