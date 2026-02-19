'use client';

import { useState } from 'react';
import { useQuery, useMutation, useClient } from 'urql';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Plus, Folder, ArrowRight, X, Pencil, Trash2, Square } from 'lucide-react';
import { useProjectsStore } from '@/stores/projects';
import { useSyncServerData } from '@/hooks/use-sync-server-data';
import { DashboardShell } from '@/components/v2/layout/dashboard-shell';
import { PROJECTS_QUERY, AGENTS_QUERY } from '@/lib/graphql/queries';
import {
  CREATE_PROJECT_MUTATION,
  DELETE_PROJECT_MUTATION,
  UPDATE_PROJECT_MUTATION,
  STOP_ALL_AGENTS_MUTATION,
} from '@/lib/graphql/mutations';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { Project } from '@/types';

export default function RootPage() {
  const projectId = useProjectsStore((s) => s.currentProjectId);

  // Bridge urql transport -> Zustand stores (no data returned, just side effects)
  useSyncServerData();

  if (!projectId) {
    return <LandingPage />;
  }

  return <DashboardShell />;
}

// ── Landing page — shown when no project selected ──

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  },
};

const ACTIVE_STATUSES = ['running', 'deploying', 'idle'];

const augBorder = (color = 'var(--border)') =>
  ({
    '--aug-tl': '8px',
    '--aug-br': '8px',
    '--aug-border-all': '1px',
    '--aug-border-bg': color,
  }) as React.CSSProperties;

function LandingPage() {
  const setCurrentProject = useProjectsStore((s) => s.setCurrentProject);
  const currentProjectId = useProjectsStore((s) => s.currentProjectId);
  const client = useClient();

  const [{ data, fetching }, reexecuteProjectsQuery] = useQuery({
    query: PROJECTS_QUERY,
  });
  const [, createProject] = useMutation(CREATE_PROJECT_MUTATION);
  const [, updateProject] = useMutation(UPDATE_PROJECT_MUTATION);
  const [, deleteProject] = useMutation(DELETE_PROJECT_MUTATION);
  const [, stopAllAgents] = useMutation(STOP_ALL_AGENTS_MUTATION);

  // Create state
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [runningAgentCount, setRunningAgentCount] = useState<number | null>(null);
  const [stoppingAgents, setStoppingAgents] = useState(false);

  const projects: Project[] = data?.projects ?? [];


  // ── Create ──

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const { data: result, error } = await createProject({ input: { name } });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (result?.createProject) {
      setCurrentProject(result.createProject.id);
      setNewName('');
      setCreating(false);
    }
  };

  // ── Rename ──

  const startRename = (project: Project) => {
    setDeletingId(null);
    setRenamingId(project.id);
    setRenameName(project.name);
  };

  const handleRename = async () => {
    if (!renamingId) return;
    const name = renameName.trim();
    if (!name) return;
    const { error } = await updateProject({ id: renamingId, name });
    if (error) {
      toast.error(error.message);
      return;
    }
    setRenamingId(null);
    setRenameName('');
    reexecuteProjectsQuery({ requestPolicy: 'network-only' });
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameName('');
  };

  // ── Delete ──

  const startDelete = async (project: Project) => {
    setRenamingId(null);
    setDeletingId(project.id);
    setDeleteConfirmName('');
    setRunningAgentCount(null);

    // Fetch agents to check for running ones
    const { data: agentsData } = await client
      .query(AGENTS_QUERY, { projectId: project.id })
      .toPromise();
    const agents = agentsData?.agents ?? [];
    const running = agents.filter(
      (a: { status: string }) => ACTIVE_STATUSES.includes(a.status)
    );
    setRunningAgentCount(running.length);
  };

  const handleStopAll = async () => {
    if (!deletingId) return;
    setStoppingAgents(true);
    const { data: result, error } = await stopAllAgents({
      projectId: deletingId,
    });
    setStoppingAgents(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const stopped = result?.stopAllAgents ?? 0;
    toast.success(`Stopped ${stopped} agent${stopped !== 1 ? 's' : ''}`);
    setRunningAgentCount(0);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    const project = projects.find((p) => p.id === deletingId);
    if (!project || deleteConfirmName !== project.name) return;

    const { error } = await deleteProject({ id: deletingId });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Project deleted');
    if (currentProjectId === deletingId) {
      setCurrentProject(null);
    }
    setDeletingId(null);
    setDeleteConfirmName('');
    reexecuteProjectsQuery({ requestPolicy: 'network-only' });
  };

  const cancelDelete = () => {
    setDeletingId(null);
    setDeleteConfirmName('');
    setRunningAgentCount(null);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="landing-grid absolute inset-0" />
      <div className="landing-glow absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2" />

      <motion.div
        className="relative z-10 w-full max-w-xl px-6"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Logo + Title */}
        <motion.div variants={fadeUp} className="flex items-center gap-4 mb-10">
          <div
            data-augmented-ui="tl-clip br-clip border"
            className="w-12 h-12 flex items-center justify-center shrink-0"
            style={
              {
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '2px',
                '--aug-border-bg': 'var(--accent)',
              } as React.CSSProperties
            }
          >
            <span className="text-accent font-bold text-xl">A</span>
          </div>
          <div>
            <h1 className="text-foreground font-bold text-xl tracking-tight">
              agentobox
            </h1>
            <p className="text-muted-foreground text-xs font-mono">
              multi-agent orchestration
            </p>
          </div>
        </motion.div>

        {/* Section label */}
        <motion.p
          variants={fadeUp}
          className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider mb-3"
        >
          {fetching
            ? 'Loading...'
            : projects.length > 0
              ? 'Select project'
              : 'Get started'}
        </motion.p>

        {/* Project cards */}
        <div className="space-y-2 mb-3">
          {projects.map((project) => {
            const isRenaming = renamingId === project.id;
            const isDeleting = deletingId === project.id;

            // ── Rename mode ──
            if (isRenaming) {
              return (
                <motion.div
                  key={project.id}
                  initial="hidden"
                  animate="show"
                  variants={fadeUp}
                  data-augmented-ui="tl-clip br-clip border"
                  style={augBorder('var(--accent)')}
                >
                  <div className="px-4 py-3 flex items-center gap-3">
                    <Folder className="w-4 h-4 text-accent shrink-0" />
                    <input
                      type="text"
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') cancelRename();
                      }}
                      className="flex-1 bg-transparent text-foreground text-sm font-mono focus:outline-none"
                      autoFocus
                      onFocus={(e) => e.target.select()}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleRename}
                        disabled={
                          !renameName.trim() ||
                          renameName.trim() === project.name
                        }
                        className="text-accent text-[10px] font-bold uppercase tracking-wider hover:opacity-80 disabled:opacity-30 transition-opacity"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelRename}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            }

            // ── Delete confirmation mode ──
            if (isDeleting) {
              const nameMatches = deleteConfirmName === project.name;
              const hasRunningAgents =
                runningAgentCount !== null && runningAgentCount > 0;
              const loading = runningAgentCount === null;

              return (
                <motion.div
                  key={project.id}
                  initial="hidden"
                  animate="show"
                  variants={fadeUp}
                  data-augmented-ui="tl-clip br-clip border"
                  style={augBorder('var(--destructive, #ef4444)')}
                >
                  <div className="px-4 py-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-foreground text-sm font-medium">
                        {project.name}
                      </p>
                      <button
                        onClick={cancelDelete}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-muted-foreground text-xs">
                      This permanently removes all agents, history, and data.
                    </p>

                    {loading ? (
                      <p className="text-muted-foreground text-xs font-mono">
                        Checking agents...
                      </p>
                    ) : hasRunningAgents ? (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-yellow-500 text-xs">
                          {runningAgentCount} agent
                          {runningAgentCount !== 1 ? 's' : ''} running
                        </p>
                        <button
                          onClick={handleStopAll}
                          disabled={stoppingAgents}
                          className="text-yellow-500 text-[10px] font-bold uppercase tracking-wider hover:opacity-80 disabled:opacity-50 transition-opacity flex items-center gap-1"
                        >
                          <Square className="w-3 h-3" />
                          {stoppingAgents ? 'Stopping...' : 'Stop all agents'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={deleteConfirmName}
                          onChange={(e) => setDeleteConfirmName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && nameMatches)
                              handleDelete();
                            if (e.key === 'Escape') cancelDelete();
                          }}
                          placeholder={`Type "${project.name}" to confirm`}
                          className="w-full bg-transparent text-foreground text-sm font-mono focus:outline-none placeholder:text-muted-foreground/30 border-b border-border/50 pb-1"
                          autoFocus
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={cancelDelete}
                            className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider hover:opacity-80 transition-opacity"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleDelete}
                            disabled={!nameMatches}
                            className="text-red-500 text-[10px] font-bold uppercase tracking-wider hover:opacity-80 disabled:opacity-30 transition-opacity"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            }

            // ── Normal project card with context menu ──
            return (
              <ContextMenu key={project.id}>
                <ContextMenuTrigger asChild>
                  <motion.button
                    initial="hidden"
                    animate="show"
                    variants={fadeUp}
                    onClick={() => setCurrentProject(project.id)}
                    data-augmented-ui="tl-clip br-clip border"
                    className="w-full text-left group"
                    style={augBorder()}
                  >
                    <div className="px-4 py-3.5 flex items-center justify-between transition-colors group-hover:bg-accent/5">
                      <div className="flex items-center gap-3">
                        <Folder className="w-4 h-4 text-muted-foreground group-hover:text-accent transition-colors" />
                        <p className="text-foreground text-sm font-medium">
                          {project.name}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground/0 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </motion.button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => startRename(project)}>
                    <Pencil className="w-4 h-4" />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => startDelete(project)}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}

          {/* Create new project */}
          <motion.div variants={fadeUp}>
            {creating ? (
              <div
                data-augmented-ui="tl-clip br-clip border"
                style={augBorder('var(--accent)')}
              >
                <div className="px-4 py-3 flex items-center gap-3">
                  <Plus className="w-4 h-4 text-accent shrink-0" />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') {
                        setCreating(false);
                        setNewName('');
                      }
                    }}
                    placeholder="project name"
                    className="flex-1 bg-transparent text-foreground text-sm font-mono focus:outline-none placeholder:text-muted-foreground/30"
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCreate}
                      disabled={!newName.trim()}
                      className="text-accent text-[10px] font-bold uppercase tracking-wider hover:opacity-80 disabled:opacity-30 transition-opacity"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => {
                        setCreating(false);
                        setNewName('');
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                data-augmented-ui="tl-clip br-clip border"
                className="w-full text-left group"
                style={
                  {
                    ...augBorder(),
                    borderStyle: 'dashed',
                  } as React.CSSProperties
                }
              >
                <div className="px-4 py-3.5 flex items-center gap-3 transition-colors group-hover:bg-accent/5">
                  <Plus className="w-4 h-4 text-muted-foreground group-hover:text-accent transition-colors" />
                  <p className="text-muted-foreground text-sm group-hover:text-foreground transition-colors">
                    New project
                  </p>
                </div>
              </button>
            )}
          </motion.div>
        </div>

        {/* Hint */}
        <motion.p
          variants={fadeUp}
          className="text-muted-foreground/40 text-[10px] font-mono"
        >
          {projects.length > 0
            ? 'right-click a project for more options'
            : 'create your first project to begin'}
        </motion.p>
      </motion.div>
    </div>
  );
}
