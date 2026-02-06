'use client';

import { useEffect } from 'react';
import { useState } from 'react';
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
import { DeployModal } from '@/components/modals/deploy-modal';
import { CREATE_AGENT_MUTATION } from '@/lib/graphql/mutations';
import { useMutation } from 'urql';
import { logger } from '@/lib/observability';
import type { Agent, AgentEvent } from '@/types';

export default function DashboardPage() {
  const projectId = useProjectsStore((s) => s.currentProjectId);
  const agents = useAgentsStore((s) =>
    projectId ? (s.agents[projectId] ?? []) : []
  );
  const setAgents = useAgentsStore((s) => s.setAgents);
  const upsertAgent = useAgentsStore((s) => s.upsertAgent);
  const events = useEventsStore((s) =>
    projectId ? (s.events[projectId] ?? []) : []
  );
  const addEvent = useEventsStore((s) => s.addEvent);

  const [showDeployModal, setShowDeployModal] = useState(false);
  const [, createAgentMut] = useMutation(CREATE_AGENT_MUTATION);

  // Fetch agents for current project
  const [{ data }] = useQuery({
    query: AGENTS_QUERY,
    variables: { projectId },
    pause: !projectId,
  });

  useEffect(() => {
    if (data?.agents && projectId) {
      setAgents(projectId, data.agents);
    }
  }, [data, projectId, setAgents]);

  // Subscribe to agent updates
  useSubscription(
    {
      query: AGENT_UPDATED_SUBSCRIPTION,
      variables: { projectId },
      pause: !projectId,
    },
    (_prev, data) => {
      if (data?.agentUpdated && projectId) {
        upsertAgent(projectId, data.agentUpdated);
      }
      return data;
    }
  );

  // Subscribe to new events
  useSubscription(
    {
      query: NEW_EVENT_SUBSCRIPTION,
      variables: { projectId },
      pause: !projectId,
    },
    (_prev, data) => {
      if (data?.newEvent && projectId) {
        addEvent(projectId, data.newEvent);
      }
      return data;
    }
  );

  const handleDeploy = async (
    name: string,
    goalText: string,
    contextPath: string
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
            runtime: 'modal',
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
        <p className="text-muted-foreground text-sm font-mono">
          Select or create a project to get started
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      <CommandPanel
        agents={agents}
        events={events}
        projectId={projectId}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <p className="text-muted-foreground text-sm font-mono">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} deployed
          </p>
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
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  projectId={projectId}
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
