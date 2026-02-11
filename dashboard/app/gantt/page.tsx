'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { GanttView, generateMockGanttData } from '@/components/gantt-view';

export default function GanttPage() {
  const { theme, setTheme, themes } = useTheme();
  const nextTheme = themes[(themes.indexOf(theme) + 1) % themes.length];
  const { entries, agentsMap } = useMemo(() => generateMockGanttData(), []);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <header
        className="h-11 flex items-center gap-4 px-4 bg-surface flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* Left: Logo + breadcrumb */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3 group">
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-7 h-7 flex items-center justify-center flex-shrink-0"
              style={
                {
                  '--aug-tl': '5px',
                  '--aug-br': '5px',
                  '--aug-border-all': '1.5px',
                  '--aug-border-bg': 'var(--accent)',
                } as React.CSSProperties
              }
            >
              <span className="text-accent font-bold text-xs">A</span>
            </div>
          </Link>
          <span className="text-muted-foreground/30 text-xs font-mono">/</span>
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
            Timeline
          </span>
        </div>

        {/* Center: mock data label */}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[9px] font-mono text-muted-foreground/30 uppercase tracking-wider">
            mock data
          </span>
        </div>

        {/* Right: back link + theme */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground hover:text-accent transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Dashboard
          </Link>
          <button
            onClick={() => setTheme(nextTheme)}
            className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
          >
            {theme}
          </button>
        </div>
      </header>

      {/* Gantt view fills remaining space */}
      <main className="flex-1 flex flex-col overflow-hidden p-4">
        <GanttView entries={entries} agentsMap={agentsMap} />
      </main>
    </div>
  );
}
