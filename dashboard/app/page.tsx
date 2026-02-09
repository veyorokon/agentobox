'use client';

import { useEffect, useState, useMemo } from 'react';
import { useQuery, useSubscription, useMutation } from 'urql';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Folder, ArrowRight, X, Terminal } from 'lucide-react';
import { useProjectsStore } from '@/stores/projects';
import { useAgentsStore } from '@/stores/agents';
import { useMessagesStore } from '@/stores/messages';
import { AGENTS_QUERY, PROJECTS_QUERY } from '@/lib/graphql/queries';
import {
  AGENT_UPDATED_SUBSCRIPTION,
  MESSAGE_RECEIVED_SUBSCRIPTION,
} from '@/lib/graphql/subscriptions';
import { CommandPanel } from '@/components/command-panel';
import { AgentCard } from '@/components/agent-card';
import { GridControl, type GridLayout, GRID_CLASSES } from '@/components/grid-control';
import { DeployModal } from '@/components/modals/deploy-modal';
import { CREATE_AGENT_MUTATION, CREATE_PROJECT_MUTATION } from '@/lib/graphql/mutations';
import { logger } from '@/lib/observability';
import type { Agent, Project } from '@/types';

const EMPTY_AGENTS: Agent[] = [];

export default function DashboardPage() {
  const projectId = useProjectsStore((s) => s.currentProjectId);
  const allAgents = useAgentsStore((s) =>
    projectId ? (s.agents[projectId] ?? EMPTY_AGENTS) : EMPTY_AGENTS
  );
  const agents = useMemo(
    () => allAgents.filter((a) => a.status !== 'stopped'),
    [allAgents]
  );
  const setAgents = useAgentsStore((s) => s.setAgents);
  const upsertAgent = useAgentsStore((s) => s.upsertAgent);
  const upsertMessage = useMessagesStore((s) => s.upsert);

  const [showDeployModal, setShowDeployModal] = useState(false);
  const [gridLayout, setGridLayout] = useState<GridLayout>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('agentobox-grid') as GridLayout | null;
      if (saved) return saved;
      return window.innerWidth >= 768 ? '2' : '1';
    }
    return '1';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [, createAgentMut] = useMutation(CREATE_AGENT_MUTATION);

  // Cmd+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const queryVars = useMemo(() => ({ projectId }), [projectId]);
  const paused = !projectId;

  // Fetch agents for current project
  const [{ data }] = useQuery({
    query: AGENTS_QUERY,
    variables: queryVars,
    pause: paused,
  });

  useEffect(() => {
    if (data?.agents && projectId) {
      setAgents(projectId, data.agents);
    }
  }, [data, projectId, setAgents]);

  // Subscribe to agent updates
  const [agentSubResult] = useSubscription(
    { query: AGENT_UPDATED_SUBSCRIPTION, variables: queryVars, pause: paused },
  );

  useEffect(() => {
    if (agentSubResult.data?.agentUpdated && projectId) {
      upsertAgent(projectId, agentSubResult.data.agentUpdated);
    }
  }, [agentSubResult.data, projectId, upsertAgent]);

  // Subscribe to stream messages
  const [messageSubResult] = useSubscription(
    { query: MESSAGE_RECEIVED_SUBSCRIPTION, variables: queryVars, pause: paused },
  );

  useEffect(() => {
    if (messageSubResult.data?.messageReceived) {
      const msg = messageSubResult.data.messageReceived;
      upsertMessage({
        ...msg,
        parts: msg.parts ?? [],
      });
    }
  }, [messageSubResult.data, upsertMessage]);

  const handleDeploy = async (
    name: string,
    runtime: string,
    mcpServers: string[] = [],
    workspacePath: string = '',
    instructions: string = '',
  ) => {
    if (!projectId) return;
    setShowDeployModal(false);
    toast(`Deploying ${name}...`, {
      description: 'Spinning up container -- this takes about 30-60s.',
    });
    try {
      await logger.withSpan('deployAgent', async () => {
        const { error } = await createAgentMut({
          input: {
            projectId,
            name,
            runtime,
            ...(mcpServers.length > 0 && { mcpServers }),
            ...(workspacePath && { workspacePath }),
            ...(instructions && { instructions }),
          },
        });
        if (error) throw error;
      });
    } catch {
      toast.error(`Failed to deploy ${name}`);
    }
  };

  if (!projectId) {
    return <LandingPage />;
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      <CommandPanel
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />

      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Subtle grid background */}
        <div className="dashboard-grid absolute inset-0 pointer-events-none" />

        <motion.div
          className="flex items-center justify-between px-6 pt-5 pb-4 relative z-10"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-center gap-4">
            <p className="text-muted-foreground text-sm font-mono">
              <span className="text-accent/60 mr-1">//</span>
              {agents.length} agent{agents.length !== 1 ? 's' : ''} deployed
            </p>
            {agents.length > 0 && (
              <GridControl value={gridLayout} onChange={setGridLayout} />
            )}
          </div>
          <button
            onClick={() => setShowDeployModal(true)}
            data-augmented-ui="tl-clip br-clip border"
            className="deploy-btn px-5 py-2.5 text-accent-foreground font-bold text-xs uppercase tracking-wider bg-accent"
            style={{
              '--aug-tl': '8px',
              '--aug-br': '8px',
              '--aug-border-all': '2px',
              '--aug-border-bg': 'var(--accent)',
            } as React.CSSProperties}
          >
            + Deploy Agent
          </button>
        </motion.div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 pb-6 relative z-10">
          {agents.length === 0 ? (
            <EmptyState />
          ) : (
            <div className={`grid gap-5 ${GRID_CLASSES[gridLayout]}`}>
              <AnimatePresence mode="popLayout">
                {agents.map((agent, i) => (
                  <motion.div
                    key={agent.id}
                    initial={{ opacity: 0, scale: 0.95, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -8 }}
                    transition={{
                      duration: 0.45,
                      delay: i * 0.06,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    layout
                  >
                    <AgentCard agent={agent} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </main>

      <DeployModal
        open={showDeployModal}
        onClose={() => setShowDeployModal(false)}
        onDeploy={handleDeploy}
      />
    </div>
  );
}

/* ============================================
   Empty State — shown when no agents deployed
   ============================================ */

function EmptyState() {
  return (
    <motion.div
      className="flex items-center justify-center h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.2 }}
    >
      <div className="text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
            className="w-16 h-16 flex items-center justify-center mx-auto mb-5"
            style={{
              '--aug-tl': '10px',
              '--aug-tr': '10px',
              '--aug-br': '10px',
              '--aug-bl': '10px',
              '--aug-border-all': '1px',
              '--aug-border-bg': 'var(--border)',
            } as React.CSSProperties}
          >
            <Terminal className="w-7 h-7 text-muted-foreground" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-muted-foreground text-sm font-mono mb-1.5">
            No agents deployed
          </p>
          <p className="text-muted-foreground/40 text-xs font-mono">
            <span className="text-accent/50">$</span> deploy an agent to begin
            <span className="empty-cursor" />
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ============================================
   Landing Page — shown when no project selected
   ============================================ */

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

function LandingPage() {
  const setCurrentProject = useProjectsStore((s) => s.setCurrentProject);
  const [{ data, fetching }] = useQuery({ query: PROJECTS_QUERY });
  const [, createProject] = useMutation(CREATE_PROJECT_MUTATION);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const projects: Project[] = data?.projects ?? [];

  // Auto-select if exactly one project exists
  useEffect(() => {
    if (projects.length === 1) {
      setCurrentProject(projects[0].id);
    }
  }, [projects, setCurrentProject]);

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

  return (
    <div className="h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Dot grid background */}
      <div className="landing-grid absolute inset-0" />

      {/* Accent glow orb */}
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
          {fetching ? 'Loading...' : projects.length > 0 ? 'Select project' : 'Get started'}
        </motion.p>

        {/* Project cards */}
        <div className="space-y-2 mb-3">
          {projects.map((project) => (
            <motion.button
              key={project.id}
              initial="hidden"
              animate="show"
              variants={fadeUp}
              onClick={() => setCurrentProject(project.id)}
              data-augmented-ui="tl-clip br-clip border"
              className="w-full text-left group"
              style={{
                '--aug-tl': '8px',
                '--aug-br': '8px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
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
          ))}

          {/* Create new project */}
          <motion.div variants={fadeUp}>
            {creating ? (
              <div
                data-augmented-ui="tl-clip br-clip border"
                style={{
                  '--aug-tl': '8px',
                  '--aug-br': '8px',
                  '--aug-border-all': '1px',
                  '--aug-border-bg': 'var(--accent)',
                } as React.CSSProperties}
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
                      onClick={() => { setCreating(false); setNewName(''); }}
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
                style={{
                  '--aug-tl': '8px',
                  '--aug-br': '8px',
                  '--aug-border-all': '1px',
                  '--aug-border-bg': 'var(--border)',
                  borderStyle: 'dashed',
                } as React.CSSProperties}
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
          {projects.length > 0 ? 'select a project to view agents' : 'create your first project to begin'}
        </motion.p>
      </motion.div>
    </div>
  );
}
