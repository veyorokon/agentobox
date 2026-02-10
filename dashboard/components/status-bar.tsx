'use client';

import { useMemo } from 'react';
import { useTheme } from '@/lib/theme';
import { useProjectsStore } from '@/stores/projects';
import { ProjectSelector } from './project-selector';
import type { Agent } from '@/types';

interface StatusBarProps {
  agents: Agent[];
}

export function StatusBar({ agents }: StatusBarProps) {
  const { theme, setTheme, themes } = useTheme();
  const nextTheme = themes[(themes.indexOf(theme) + 1) % themes.length];
  const projectId = useProjectsStore((s) => s.currentProjectId);

  const stats = useMemo(() => {
    const running = agents.filter((a) => a.status === 'running').length;
    const error = agents.filter((a) => a.status === 'error').length;
    const idle = agents.filter((a) => a.status === 'idle').length;
    const deploying = agents.filter((a) => a.status === 'deploying').length;
    const totalCost = agents.reduce(
      (sum, a) => sum + Number(a.sessionCostUsd || 0),
      0
    );
    return { running, error, idle, deploying, totalCost };
  }, [agents]);

  return (
    <header
      className="h-11 flex items-center gap-4 px-4 bg-surface flex-shrink-0"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* Left: Logo + project */}
      <div className="flex items-center gap-3">
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="w-7 h-7 flex items-center justify-center flex-shrink-0"
          style={{
            '--aug-tl': '5px',
            '--aug-br': '5px',
            '--aug-border-all': '1.5px',
            '--aug-border-bg': 'var(--accent)',
          } as React.CSSProperties}
        >
          <span className="text-accent font-bold text-xs">A</span>
        </div>
        {projectId && <ProjectSelector />}
      </div>

      {/* Center: Fleet health dots */}
      <div className="flex-1 flex items-center justify-center gap-3">
        {agents.length > 0 && (
          <>
            {stats.running > 0 && (
              <StatusSegment
                count={stats.running}
                label="running"
                color="var(--agent-active)"
                pulse
              />
            )}
            {stats.error > 0 && (
              <StatusSegment
                count={stats.error}
                label="error"
                color="var(--agent-dead)"
              />
            )}
            {stats.idle > 0 && (
              <StatusSegment
                count={stats.idle}
                label="idle"
                color="var(--muted-foreground)"
              />
            )}
            {stats.deploying > 0 && (
              <StatusSegment
                count={stats.deploying}
                label="deploying"
                color="var(--agent-deploying)"
                pulse
              />
            )}
          </>
        )}
      </div>

      {/* Right: Cost + theme */}
      <div className="flex items-center gap-3">
        {stats.totalCost > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground">
            ${stats.totalCost.toFixed(2)}
          </span>
        )}
        <button
          onClick={() => setTheme(nextTheme)}
          className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
        >
          {theme}
        </button>
      </div>
    </header>
  );
}

function StatusSegment({
  count,
  label,
  color,
  pulse,
}: {
  count: number;
  label: string;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: color,
          boxShadow: pulse ? `0 0 6px ${color}` : 'none',
          animation: pulse ? 'border-pulse 2s ease-in-out infinite' : 'none',
        }}
      />
      <span
        className="text-[10px] font-mono font-bold tabular-nums"
        style={{ color }}
      >
        {count}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
