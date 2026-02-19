'use client';

import { useMemo, useCallback } from 'react';
import { useMutation } from 'urql';
import { ArrowLeft, ChevronDown, Plus, Loader2, KeyRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useTheme, resolveThemeTokens } from '@/lib/theme';
import { SET_PROJECT_THEME_MUTATION } from '@/lib/graphql/mutations';
import { useProjectsStore } from '@/stores/projects';
import { useAuthStore } from '@/stores/auth';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentsStore } from '@/stores/agents';
import { useProjects, useMe } from '@/hooks/use-dashboard-data';
import { StatusSegment } from './status-segment';

export function StatusBar() {
  const { theme, setTheme, themes } = useTheme();
  const projectId = useProjectsStore((s) => s.currentProjectId);
  const setCurrentProject = useProjectsStore((s) => s.setCurrentProject);
  const logout = useAuthStore((s) => s.logout);
  const setSecretsDialogOpen = useDashboardStore((s) => s.setSecretsDialogOpen);

  const [, setProjectTheme] = useMutation(SET_PROJECT_THEME_MUTATION);

  const projects = useProjects();
  const stats = useAgentsStore((s) => s.stats);
  const loading = useAgentsStore((s) => s.fetching);
  const me = useMe();

  const handleThemeSelect = useCallback((t: typeof theme) => {
    setTheme(t);
    requestAnimationFrame(() => {
      if (!projectId) return;
      const tokens = resolveThemeTokens();
      setProjectTheme({ input: { projectId, tokens } });
    });
  }, [setTheme, projectId, setProjectTheme]);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId]
  );
  const projectName = currentProject?.name ?? 'Select project';
  const username = me?.username ?? '';

  return (
    <header
      className="h-11 flex items-center gap-4 px-4 bg-surface flex-shrink-0"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* Left: Back + Logo + Project */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => useProjectsStore.setState({ currentProjectId: null })}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          title="Back to project selection"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
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
        <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
          v2
        </span>

        <span
          className="w-1 h-1 rounded-full flex-shrink-0"
          style={{ background: 'var(--muted-foreground)', opacity: 0.3 }}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-1 cursor-pointer hover:opacity-100 transition-opacity"
              style={{ opacity: 0.7 }}
              title="Switch project"
            >
              <span
                className="text-[10px] font-mono"
                style={{ color: 'var(--foreground)' }}
              >
                {projectName}
              </span>
              <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[180px]"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => setCurrentProject(project.id)}
                className="text-[9px] font-mono cursor-pointer gap-2"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: project.id === projectId ? 'var(--accent)' : 'transparent',
                  }}
                />
                <span
                  style={{
                    color: project.id === projectId ? 'var(--foreground)' : 'var(--muted-foreground)',
                  }}
                >
                  {project.name}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => useProjectsStore.setState({ currentProjectId: null })}
              className="text-[9px] font-mono cursor-pointer gap-2"
            >
              <Plus className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }} />
              <span className="text-muted-foreground/50 uppercase tracking-wider">New project</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Center: Fleet health + cost */}
      <div className="flex-1 flex items-center justify-center gap-4">
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
            <span className="text-[10px] font-mono text-muted-foreground">Loading...</span>
          </div>
        ) : (
          <>
            {stats.running > 0 && (
              <StatusSegment count={stats.running} label="running" color="var(--agent-active)" pulse />
            )}
            {stats.idle > 0 && (
              <StatusSegment count={stats.idle} label="idle" color="var(--muted-foreground)" />
            )}
            {stats.totalCost > 0 && (
              <div className="flex items-center gap-1.5">
                <span
                  className="text-[11px] font-mono font-bold tabular-nums"
                  style={{ color: 'var(--accent)' }}
                >
                  ${stats.totalCost.toFixed(2)}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                  spent
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Right: user + secrets + theme */}
      <div className="flex items-center gap-3">
        <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
          {username}
        </span>
        <span
          className="w-1 h-1 rounded-full flex-shrink-0"
          style={{ background: 'var(--muted-foreground)', opacity: 0.3 }}
        />
        <button
          onClick={() => setSecretsDialogOpen(true)}
          className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40 hover:text-accent transition-colors uppercase tracking-wider"
          title="Manage secrets"
        >
          <KeyRound className="w-3 h-3" />
          secrets
        </button>
        <span
          className="w-1 h-1 rounded-full flex-shrink-0"
          style={{ background: 'var(--muted-foreground)', opacity: 0.3 }}
        />
        <button
          onClick={logout}
          className="text-[9px] font-mono text-muted-foreground/40 hover:text-destructive transition-colors uppercase tracking-wider"
        >
          logout
        </button>
        <span
          className="w-1 h-1 rounded-full flex-shrink-0"
          style={{ background: 'var(--muted-foreground)', opacity: 0.3 }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2 py-1 cursor-pointer"
              title="Switch theme"
            >
              {theme}
              <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[140px]"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            {themes.map((t) => (
              <DropdownMenuItem
                key={t}
                onClick={() => handleThemeSelect(t)}
                className="text-[9px] font-mono cursor-pointer gap-2"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: t === theme ? 'var(--accent)' : 'transparent',
                  }}
                />
                <span
                  className="uppercase tracking-wider"
                  style={{
                    color: t === theme ? 'var(--foreground)' : 'var(--muted-foreground)',
                  }}
                >
                  {t}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
