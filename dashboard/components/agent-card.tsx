'use client';

import { useState, useRef } from 'react';
import { Monitor, RefreshCw, Pause, Square, Loader2 } from 'lucide-react';
import { useMutation } from 'urql';
import { toast } from 'sonner';
import { logger } from '@/lib/observability';
import { KILL_AGENT_MUTATION } from '@/lib/graphql/mutations';
import { StatusBadge, STATUS_COLOR_VAR } from './status-badge';
import { VncFrame } from './vnc-frame';
import { ConfirmModal } from './modals/confirm-modal';
import type { Agent } from '@/types';

export function AgentCard({
  agent,
}: {
  agent: Agent;
}) {
  const isDeploying = agent.status === 'deploying';
  const isWorking = agent.status === 'working';
  const statusColor = STATUS_COLOR_VAR[agent.status];
  const vncRefreshRef = useRef<(() => void) | null>(null);
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  const [, killAgentMut] = useMutation(KILL_AGENT_MUTATION);

  const handleKill = async () => {
    setShowKillConfirm(false);
    try {
      await logger.withSpan('killAgent', async () => {
        const { error } = await killAgentMut({
          agentId: agent.id,
        });
        if (error) throw error;
      });
    } catch {
      toast.error(`Failed to kill ${agent.name}`);
    }
  };

  const borderColor = isDeploying
    ? 'var(--agent-deploying)'
    : isWorking
      ? 'var(--agent-border-active)'
      : 'var(--agent-border)';

  return (
    <div
      data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
      className={`bg-card backdrop-blur overflow-hidden${isDeploying ? ' deploying-card' : ''}`}
      style={{
        '--aug-tl': '20px',
        '--aug-tr': '20px',
        '--aug-br': '20px',
        '--aug-bl': '20px',
        '--aug-border-all': '1px',
        '--aug-border-bg': borderColor,
      } as React.CSSProperties}
    >
      <div className="p-5">
        {/* Header: avatar + name/status + goal + controls */}
        <div className="flex items-center gap-3 mb-3">
          <div
            data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
            className="w-10 h-10 flex items-center justify-center flex-shrink-0"
            style={{
              '--aug-tl': '7px',
              '--aug-tr': '7px',
              '--aug-br': '7px',
              '--aug-bl': '7px',
              '--aug-border-all': '2px',
              '--aug-border-bg': statusColor,
              background: isWorking ? 'var(--agent-glow)' : 'transparent',
            } as React.CSSProperties}
          >
            <span
              className="text-sm font-bold uppercase"
              style={{ color: statusColor }}
            >
              {agent.name.slice(0, 2)}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-card-foreground text-sm capitalize leading-tight">
              {agent.name}
            </h3>
            <StatusBadge status={agent.status} />
          </div>
          <div className="flex-1 min-w-0 text-center">
            {agent.goal?.text && (
              <p className="text-card-foreground text-xs truncate">
                {agent.goal.text}
              </p>
            )}
            <p className="text-muted-foreground text-[10px] truncate">
              {agent.summary ||
                (agent.goal?.text ? '' : 'Waiting for instructions...')}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => vncRefreshRef.current?.()}
              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh VNC"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Pause"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowKillConfirm(true)}
              className="w-7 h-7 flex items-center justify-center text-destructive/60 hover:text-destructive transition-colors"
              title="Kill agent"
            >
              <Square className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* VNC Stream */}
        <div className="aspect-video bg-surface-inset overflow-hidden">
          {isDeploying ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <Loader2
                  className="w-6 h-6 mx-auto mb-1.5 animate-spin"
                  style={{ color: 'var(--agent-deploying)' }}
                />
                <span
                  className="text-[10px] uppercase tracking-wider font-semibold"
                  style={{ color: 'var(--agent-deploying)' }}
                >
                  Deploying...
                </span>
              </div>
            </div>
          ) : agent.vncUrl && agent.status !== 'dead' && agent.status !== 'terminated' ? (
            <VncFrame
              url={agent.vncUrl}
              onRefresh={(fn) => {
                vncRefreshRef.current = fn;
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <Monitor className="w-6 h-6 text-muted-foreground mx-auto mb-1.5" />
                <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  VNC Stream
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={showKillConfirm}
        title="Terminate Agent"
        message={`This will stop the container and remove agent "${agent.name}". This action cannot be undone.`}
        confirmLabel="Terminate"
        destructive
        onConfirm={handleKill}
        onCancel={() => setShowKillConfirm(false)}
      />
    </div>
  );
}
