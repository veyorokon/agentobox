'use client';

import { useEffect, useState, useMemo } from 'react';
import { useQuery, useSubscription } from 'urql';
import { toast } from 'sonner';
import { useProjectsStore } from '@/stores/projects';
import { useAgentsStore } from '@/stores/agents';
import { useEventsStore } from '@/stores/events';
import { AGENTS_QUERY } from '@/lib/graphql/queries';
import {
  AGENT_UPDATED_SUBSCRIPTION,
  NEW_EVENT_SUBSCRIPTION,
} from '@/lib/graphql/subscriptions';
import { CommandPanel } from '@/components/command-panel';
import { AgentCard } from '@/components/agent-card';
import { GridControl, type GridLayout, GRID_CLASSES } from '@/components/grid-control';
import { DeployModal } from '@/components/modals/deploy-modal';
import { ProjectSelector } from '@/components/project-selector';
import { CREATE_AGENT_MUTATION } from '@/lib/graphql/mutations';
import { useMutation } from 'urql';
import { logger } from '@/lib/observability';
import type { Agent, AgentEvent } from '@/types';

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_EVENTS: AgentEvent[] = [];

export default function DashboardPage() {
  const projectId = useProjectsStore((s) => s.currentProjectId);
  const allAgents = useAgentsStore((s) =>
    projectId ? (s.agents[projectId] ?? EMPTY_AGENTS) : EMPTY_AGENTS
  );
  const agents = useMemo(
    () => allAgents.filter((a) => a.status !== 'terminated'),
    [allAgents]
  );
  const setAgents = useAgentsStore((s) => s.setAgents);
  const upsertAgent = useAgentsStore((s) => s.upsertAgent);
  const events = useEventsStore((s) =>
    projectId ? (s.events[projectId] ?? EMPTY_EVENTS) : EMPTY_EVENTS
  );
  const addEvent = useEventsStore((s) => s.addEvent);

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

  // Subscribe to agent updates — sync to store via useEffect, not in the reducer
  const [agentSubResult] = useSubscription(
    { query: AGENT_UPDATED_SUBSCRIPTION, variables: queryVars, pause: paused },
  );

  useEffect(() => {
    if (agentSubResult.data?.agentUpdated && projectId) {
      upsertAgent(projectId, agentSubResult.data.agentUpdated);
    }
  }, [agentSubResult.data, projectId, upsertAgent]);

  // Subscribe to new events
  const [eventSubResult] = useSubscription(
    { query: NEW_EVENT_SUBSCRIPTION, variables: queryVars, pause: paused },
  );

  useEffect(() => {
    if (eventSubResult.data?.newEvent && projectId) {
      addEvent(projectId, eventSubResult.data.newEvent);
    }
  }, [eventSubResult.data, projectId, addEvent]);

  const handleDeploy = async (
    name: string,
    goalText: string,
    contextPath: string,
    runtime: string
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
            goalText,
            contextPath,
            runtime,
          },
        });
        if (error) throw error;
      });
    } catch {
      toast.error(`Failed to deploy ${name}`);
    }
  };

  if (!projectId) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-14 h-14 flex items-center justify-center"
              style={{
                '--aug-tl': '10px',
                '--aug-br': '10px',
                '--aug-border-all': '2px',
                '--aug-border-bg': 'var(--accent)',
              } as React.CSSProperties}
            >
              <span className="text-accent font-bold text-2xl">A</span>
            </div>
          </div>
          <p className="text-foreground font-bold text-lg mb-2">agentobox</p>
          <p className="text-muted-foreground text-sm font-mono mb-6">
            Create a project to get started
          </p>
          <ProjectSelector />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      <CommandPanel
        agents={agents}
        events={events}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div className="flex items-center gap-4">
            <p className="text-muted-foreground text-sm font-mono">
              {agents.length} agent{agents.length !== 1 ? 's' : ''} deployed
            </p>
            {agents.length > 0 && (
              <GridControl value={gridLayout} onChange={setGridLayout} />
            )}
          </div>
          <button
            onClick={() => setShowDeployModal(true)}
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
          {agents.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-muted-foreground text-sm mb-2">
                  No agents deployed yet
                </p>
                <p className="text-muted-foreground/60 text-xs">
                  Click &quot;Deploy Agent&quot; to get started
                </p>
              </div>
            </div>
          ) : (
            <div className={`grid gap-5 ${GRID_CLASSES[gridLayout]}`}>
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                />
              ))}
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
