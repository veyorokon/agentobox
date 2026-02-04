'use client';

import { Activity, Monitor, MessageSquare, Settings } from 'lucide-react';
import { mockAgents, mockBentos } from '@/lib/mock-data';
import { STATE_COLORS, STATE_LABELS } from '@/lib/constants';
import type { Agent, AgentStatus } from '@/types';

// Get all agents from first bento for demo
const agents = mockAgents['bento-1'];

export default function DashboardPage() {
  return (
    <div className="min-h-screen nb-grid-bg p-8">
      {/* Header */}
      <header className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--nb-text)]">
            AgentBox
          </h1>
          <button className="nb-button bg-[var(--nb-purple)] text-[var(--nb-text-light)] px-4 py-2 font-semibold">
            + New Agent
          </button>
        </div>
        <p className="text-[var(--nb-text-muted)] mt-1">
          Website Redesign - 4 agents
        </p>
      </header>

      {/* Agent Grid */}
      <main className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {agents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      </main>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const colors = STATE_COLORS[agent.status];

  return (
    <div className="nb-card overflow-hidden">
      {/* Card split into two sections like the reference image */}
      <div className="flex min-h-[280px]">
        {/* Left: White section with chat */}
        <div className="flex-1 bg-[var(--nb-white)] p-5 flex flex-col">
          {/* Agent header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${colors.bg} border-2 border-[var(--nb-border)] flex items-center justify-center`}>
                <span className={`text-sm font-bold uppercase ${colors.text}`}>
                  {agent.name.slice(0, 2)}
                </span>
              </div>
              <div>
                <h3 className="font-bold text-[var(--nb-text)] capitalize">{agent.name}</h3>
                <StatusBadge status={agent.status} />
              </div>
            </div>
          </div>

          {/* Chat area */}
          <div className="flex-1 space-y-3">
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full bg-[var(--nb-coral)] border border-[var(--nb-border)] flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-3.5 h-3.5 text-[var(--nb-text-light)]" />
              </div>
              <div className="bg-[var(--nb-bg)] rounded-xl rounded-tl-sm px-3 py-2 text-sm text-[var(--nb-text)] border border-[var(--nb-grid)]">
                Start the task...
              </div>
            </div>

            {agent.message && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-[var(--nb-purple)] border border-[var(--nb-border)] flex items-center justify-center flex-shrink-0">
                  <Activity className="w-3.5 h-3.5 text-[var(--nb-text-light)]" />
                </div>
                <div className="bg-[var(--nb-bg)] rounded-xl rounded-tl-sm px-3 py-2 text-sm text-[var(--nb-text)] border border-[var(--nb-grid)]">
                  {agent.message}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="mt-3 flex items-center gap-2 bg-[var(--nb-bg)] rounded-full px-3 py-2 border border-[var(--nb-grid)]">
            <input
              type="text"
              placeholder="Type a message..."
              className="flex-1 bg-transparent text-sm text-[var(--nb-text)] placeholder-[var(--nb-text-muted)] outline-none"
            />
          </div>
        </div>

        {/* Right: Colored sections */}
        <div className="w-[45%] flex flex-col">
          {/* Top: Purple - Agent's Eye */}
          <div className="flex-1 bg-[var(--nb-purple)] p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-[var(--nb-text-light)] uppercase tracking-wide">
                Agent's Eye
              </h4>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--nb-coral)] animate-pulse" />
                <span className="text-[10px] text-[var(--nb-text-light)]/70">LIVE</span>
              </div>
            </div>
            <div className="flex-1 bg-[var(--nb-dark)] rounded-lg flex items-center justify-center">
              <Monitor className="w-8 h-8 text-[var(--nb-text-muted)]" />
            </div>
          </div>

          {/* Bottom: Coral - Controls */}
          <div className="flex-1 bg-[var(--nb-coral)] p-4 flex flex-col">
            <h4 className="text-xs font-bold text-[var(--nb-text)] uppercase tracking-wide mb-2">
              Controls
            </h4>
            <div className="flex-1 flex items-center justify-center gap-3">
              <button className="w-12 h-12 rounded-xl bg-[var(--nb-white)] border-2 border-[var(--nb-border)] shadow-[2px_2px_0_var(--nb-border)] hover:shadow-[1px_1px_0_var(--nb-border)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all flex items-center justify-center">
                <Settings className="w-5 h-5 text-[var(--nb-text)]" />
              </button>
              <button className="w-12 h-12 rounded-xl bg-[var(--nb-yellow)] border-2 border-[var(--nb-border)] shadow-[2px_2px_0_var(--nb-border)] hover:shadow-[1px_1px_0_var(--nb-border)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all flex items-center justify-center font-bold text-[var(--nb-text)]">
                ||
              </button>
              <button className="w-12 h-12 rounded-xl bg-[var(--nb-coral)] border-2 border-[var(--nb-border)] shadow-[2px_2px_0_var(--nb-border)] hover:shadow-[1px_1px_0_var(--nb-border)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all flex items-center justify-center font-bold text-[var(--nb-text-light)]">
                X
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const colors = STATE_COLORS[status];
  const label = STATE_LABELS[status];

  return (
    <span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>
      {label}
    </span>
  );
}
