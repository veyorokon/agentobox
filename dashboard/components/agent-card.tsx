'use client';

import { useState, useRef, useEffect } from 'react';
import { Monitor, RefreshCw, Pause, Play, Square, Loader2 } from 'lucide-react';
import { useMutation } from 'urql';
import { toast } from 'sonner';
import { logger } from '@/lib/observability';
import { KILL_AGENT_MUTATION, INTERRUPT_AGENT_MUTATION, SEND_MESSAGE_MUTATION } from '@/lib/graphql/mutations';
import { STATUS_COLOR_VAR } from './status-badge';
import { VncFrame } from './vnc-frame';
import { ConfirmModal } from './modals/confirm-modal';
import type { Agent } from '@/types';

/* Spinner words (shared with command-panel) */
const SPINNER_WORDS = [
  'Moseying', 'Tinkering', 'Spelunking', 'Pondering', 'Cogitating',
  'Ruminating', 'Noodling', 'Percolating', 'Brainstorming', 'Contemplating',
  'Mulling', 'Analyzing', 'Investigating', 'Exploring', 'Researching',
  'Parsing', 'Decoding', 'Assembling', 'Crafting', 'Forging',
  'Polishing', 'Refining', 'Calibrating', 'Tweaking', 'Wiring',
  'Weaving', 'Connecting', 'Patching', 'Debugging', 'Diagnosing',
  'Sorting', 'Mapping', 'Composing', 'Orchestrating', 'Synthesizing',
  'Compiling', 'Processing', 'Distilling', 'Brewing', 'Conjuring',
  'Focusing', 'Scanning', 'Surveying', 'Excavating', 'Navigating',
  'Traversing', 'Adventuring', 'Questing',
];

export function AgentCard({
  agent,
}: {
  agent: Agent;
}) {
  const [stopping, setStopping] = useState(false);

  const [spinnerWord, setSpinnerWord] = useState(() =>
    SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]
  );

  // Rotate spinner word with staggered timing per card
  const spinnerIntervalRef = useRef(3500 + Math.random() * 1000);
  const spinnerDelayRef = useRef(Math.random() * 3000);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const timeout = setTimeout(() => {
      setSpinnerWord(SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]);
      interval = setInterval(() => {
        setSpinnerWord(SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]);
      }, spinnerIntervalRef.current);
    }, spinnerDelayRef.current);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

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

  // Stagger card glow animation phase
  const pulseDelayRef = useRef(`-${(Math.random() * 3).toFixed(2)}s`);

  // Cost badge
  const cost = agent.sessionCostUsd != null ? Number(agent.sessionCostUsd) : null;
  const costLabel = cost != null && cost > 0 ? `$${cost.toFixed(2)}` : null;

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
        animationDelay: isRunning ? pulseDelayRef.current : undefined,
      } as React.CSSProperties}
    >
      <div className="p-5">
        {/* Header: name + status inline + controls */}
        <div className="flex items-center gap-2 mb-3">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: statusColor,
              boxShadow: isRunning ? `0 0 6px ${statusColor}` : 'none',
              animation: isRunning ? 'border-pulse 2s ease-in-out infinite' : 'none',
            }}
          />
          <h3 className="font-bold text-card-foreground text-sm capitalize leading-tight">
            {agent.name}
          </h3>
          {isStopping ? (
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{ color: 'var(--agent-dead)' }}
            >
              Stopping...
            </span>
          ) : isRunning ? (
            <span className="text-[10px] font-mono text-muted-foreground truncate min-w-0">
              <span className="font-bold tracking-wider" style={{ color: statusColor }}>
                {spinnerWord}...
              </span>
            </span>
          ) : (
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-wider"
              style={{ color: statusColor, opacity: 0.7 }}
            >
              {effectiveStatus}
            </span>
          )}
          {costLabel && (
            <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto mr-1">
              {costLabel}
            </span>
          )}
          <div className="flex-1" />
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
