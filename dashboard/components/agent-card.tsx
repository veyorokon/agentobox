'use client';

import { useState, useRef } from 'react';
import { Monitor, RefreshCw, Pause, Play, Square, Loader2 } from 'lucide-react';
import { useMutation } from 'urql';
import { toast } from 'sonner';
import { logger } from '@/lib/observability';
import { KILL_AGENT_MUTATION, INTERRUPT_AGENT_MUTATION, SEND_MESSAGE_MUTATION } from '@/lib/graphql/mutations';
import { StatusBadge, STATUS_COLOR_VAR } from './status-badge';
import { VncFrame } from './vnc-frame';
import { ConfirmModal } from './modals/confirm-modal';
import type { Agent } from '@/types';

export function AgentCard({
  agent,
}: {
  agent: Agent;
}) {
  const [stopping, setStopping] = useState(false);

  const effectiveStatus = stopping ? 'stopped' as const : agent.status;
  const isDeploying = effectiveStatus === 'deploying';
  const isRunning = effectiveStatus === 'running';
  const isStopping = stopping && agent.status !== 'stopped';
  const statusColor = STATUS_COLOR_VAR[effectiveStatus];
  const vncRefreshRef = useRef<(() => void) | null>(null);
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  const [, killAgentMut] = useMutation(KILL_AGENT_MUTATION);
  const [{ fetching: interrupting }, interruptAgentMut] = useMutation(INTERRUPT_AGENT_MUTATION);
  const [{ fetching: resuming }, sendMessageMut] = useMutation(SEND_MESSAGE_MUTATION);
  const pausePlayLoading = interrupting || resuming;

  const handleKill = async () => {
    setShowKillConfirm(false);
    setStopping(true);
    try {
      await logger.withSpan('killAgent', async () => {
        const { error } = await killAgentMut({
          agentId: agent.id,
        });
        if (error) throw error;
      });
    } catch {
      setStopping(false);
      toast.error(`Failed to kill ${agent.name}`);
    }
  };

  const handlePausePlay = async () => {
    try {
      if (isRunning) {
        await logger.withSpan('interruptAgent', async () => {
          const { error } = await interruptAgentMut({ agentId: agent.id });
          if (error) throw error;
        });
      } else if (effectiveStatus === 'idle') {
        await logger.withSpan('resumeAgent', async () => {
          const { error } = await sendMessageMut({
            input: { agentId: agent.id, message: 'continue' },
          });
          if (error) throw error;
        });
      }
    } catch {
      toast.error(`Failed to ${isRunning ? 'pause' : 'resume'} ${agent.name}`);
    }
  };

  const pausePlayDisabled =
    isStopping ||
    pausePlayLoading ||
    effectiveStatus === 'stopped' ||
    effectiveStatus === 'error' ||
    effectiveStatus === 'deploying';

  const borderColor = isStopping
    ? 'var(--agent-dead)'
    : isDeploying
      ? 'var(--agent-deploying)'
      : isRunning
        ? 'var(--agent-border-active)'
        : 'var(--agent-border)';

  return (
    <div
      data-augmented-ui="tl-clip tr-clip br-clip bl-clip border"
      className={`bg-card backdrop-blur overflow-hidden${isDeploying ? ' deploying-card' : ''}${isRunning ? ' running-card' : ''}${isStopping ? ' opacity-60' : ''}`}
      style={{
        '--aug-tl': '20px',
        '--aug-tr': '20px',
        '--aug-br': '20px',
        '--aug-bl': '20px',
        '--aug-border-all': '1px',
        '--aug-border-bg': borderColor,
        transition: 'opacity 0.3s ease',
      } as React.CSSProperties}
    >
      <div className="p-5">
        {/* Header: avatar + name/status + controls */}
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
              background: isRunning ? 'var(--agent-glow)' : 'transparent',
            } as React.CSSProperties}
          >
            <span
              className="text-sm font-bold uppercase"
              style={{ color: statusColor }}
            >
              {agent.name.slice(0, 2)}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-card-foreground text-sm capitalize leading-tight">
              {agent.name}
            </h3>
            {isStopping ? (
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--agent-dead)' }}
              >
                Stopping...
              </span>
            ) : (
              <StatusBadge status={effectiveStatus} />
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => vncRefreshRef.current?.()}
              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh VNC"
              disabled={isStopping}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handlePausePlay}
              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={isRunning ? 'Pause agent' : 'Resume agent'}
              disabled={pausePlayDisabled}
            >
              {pausePlayLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isRunning ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={() => setShowKillConfirm(true)}
              className="w-7 h-7 flex items-center justify-center text-destructive/60 hover:text-destructive transition-colors"
              title="Kill agent"
              disabled={isStopping}
            >
              {isStopping ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Square className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>

        {/* VNC Stream */}
        <div className="aspect-video bg-surface-inset overflow-hidden vnc-scanline">
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
          ) : agent.vncUrl && agent.status !== 'stopped' && agent.status !== 'error' && !isStopping ? (
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
