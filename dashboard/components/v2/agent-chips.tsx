'use client';

import { useState, useCallback } from 'react';
import { Plus, Crown, Code2, Image, RotateCw, Square, Play, Eraser, Trash2, Settings2, Eye, Pencil } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentsStore } from '@/stores/agents';
import { useFeedStore } from '@/stores/feed';
import { useAgentActions } from '@/hooks/use-agent-actions';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import type { FeedItem } from '@/lib/mock-v2-data';
import type { AgentPhase } from '@/types';

function chipDotStyle(status: string, phase: AgentPhase = ''): React.CSSProperties {
  switch (status) {
    case 'deploying':
      return {
        background: 'var(--agent-deploying)',
        boxShadow: 'none',
        animation: 'border-pulse 1.5s ease-in-out infinite',
      };
    case 'running':
      if (phase === 'thinking') {
        return {
          background: 'var(--agent-thinking)',
          boxShadow: '0 0 6px var(--agent-thinking)',
          animation: 'border-pulse 1s ease-in-out infinite',
        };
      }
      return {
        background: 'var(--agent-active)',
        boxShadow: '0 0 6px var(--agent-active)',
        animation: 'border-pulse 2s ease-in-out infinite',
      };
    case 'idle':
      return {
        background: 'var(--agent-active)',
        boxShadow: 'none',
        animation: 'none',
        opacity: 0.5,
      };
    case 'error':
      return {
        background: 'var(--agent-dead)',
        boxShadow: '0 0 4px var(--agent-dead)',
        animation: 'none',
      };
    case 'stopped':
      return {
        background: 'var(--muted-foreground)',
        boxShadow: 'none',
        animation: 'none',
        opacity: 0.4,
      };
    default:
      return {
        background: 'var(--muted-foreground)',
        boxShadow: 'none',
        animation: 'none',
      };
  }
}

// Check which agent IDs have unanswered questions
function getAgentsWithPendingQuestions(feedItems: FeedItem[]): Set<string> {
  const agentIds = new Set<string>();
  for (const item of feedItems) {
    if (item.kind !== 'question' || !item.questions) continue;
    const answers = item.answers ?? [];
    const allAnswered = item.questions.every((_, i) => answers[i] !== undefined);
    if (!allAnswered) {
      agentIds.add(item.agentId);
    }
  }
  return agentIds;
}

// ── Feed display toggles (top of feed) ──

export function FeedViewToggles() {
  const expandText = useDashboardStore((s) => s.expandText);
  const toggleExpandText = useDashboardStore((s) => s.toggleExpandText);
  const expandImages = useDashboardStore((s) => s.expandImages);
  const toggleExpandImages = useDashboardStore((s) => s.toggleExpandImages);

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <span className="text-[8px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Feed
      </span>
      <div className="flex-1" />
      <button
        onClick={toggleExpandText}
        className={`flex items-center gap-1 text-[9px] font-mono transition-colors ${
          expandText
            ? 'text-accent'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title={expandText ? 'Collapse text tools' : 'Expand text tools'}
      >
        <Code2 className="w-3 h-3" />
        Text
      </button>
      <span className="text-muted-foreground/30">|</span>
      <button
        onClick={toggleExpandImages}
        className={`flex items-center gap-1 text-[9px] font-mono transition-colors ${
          expandImages
            ? 'text-accent'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title={expandImages ? 'Collapse images' : 'Expand images'}
      >
        <Image className="w-3 h-3" />
        Images
      </button>
    </div>
  );
}

// ── Agent chip bar (inside composer) ──

export function AgentChipBar({ onOpenConfig }: { onOpenConfig?: () => void }) {
  const selectedAgentId = useDashboardStore((s) => s.selectedAgentId);
  const setSelectedAgent = useDashboardStore((s) => s.setSelectedAgent);
  const setDeployDialogOpen = useDashboardStore((s) => s.setDeployDialogOpen);

  const agents = useAgentsStore((s) => s.sortedAgents);
  const colorMap = useAgentsStore((s) => s.agentColors);
  const feedItems = useFeedStore((s) => s.items);
  const { restartAgent, hardRestartAgent, startAgent, clearAgentSession, killAgent, removeAgent, setAgentMode } = useAgentActions();

  const pendingQuestionAgents = getAgentsWithPendingQuestions(feedItems);

  // Track which agent's actions popover is open (null = none)
  const [actionsAgentId, setActionsAgentId] = useState<string | null>(null);

  const closeActions = useCallback(() => setActionsAgentId(null), []);

  // Action helper — execute callback then close popover
  const doAction = useCallback((fn: () => void) => {
    fn();
    setActionsAgentId(null);
  }, []);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* All chip */}
      <button
        onClick={() => setSelectedAgent(null)}
        className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-all select-none"
        data-augmented-ui="tl-clip br-clip border"
        style={{
          '--aug-tl': '4px',
          '--aug-br': '4px',
          '--aug-border-all': '1px',
          '--aug-border-bg': selectedAgentId === null ? 'var(--accent)' : 'var(--border)',
          color: selectedAgentId === null ? 'var(--accent)' : 'var(--muted-foreground)',
          background: selectedAgentId === null
            ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
            : 'transparent',
        } as React.CSSProperties}
      >
        All
      </button>

      {/* Agent chips */}
      {agents.map((agent) => {
        const color = colorMap[agent.id] ?? 'var(--muted-foreground)';
        const isSelected = selectedAgentId === agent.id;
        const isLead = agent.role === 'lead';
        const hasPendingQuestion = pendingQuestionAgents.has(agent.id);
        const isAlive = ['running', 'idle'].includes(agent.status);
        const isDead = ['error', 'stopped'].includes(agent.status);
        const hasActions = isAlive || isDead || agent.status === 'deploying';
        const actionsOpen = actionsAgentId === agent.id;

        return (
          <div key={agent.id} className="relative">
            <Popover
              open={actionsOpen}
              onOpenChange={(open) => { if (!open) setActionsAgentId(null); }}
            >
              <PopoverAnchor asChild>
                <button
                  onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
                  onContextMenu={(e) => {
                    if (!hasActions) return;
                    e.preventDefault();
                    setActionsAgentId(actionsOpen ? null : agent.id);
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-all select-none"
                  data-augmented-ui="tl-clip br-clip border"
                  style={{
                    '--aug-tl': '4px',
                    '--aug-br': '4px',
                    '--aug-border-all': '1px',
                    '--aug-border-bg': isSelected ? color : 'var(--border)',
                    color: isSelected ? color : 'var(--muted-foreground)',
                    background: isSelected
                      ? `color-mix(in srgb, ${color} 10%, transparent)`
                      : 'transparent',
                  } as React.CSSProperties}
                >
                  {/* Status dot */}
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={chipDotStyle(agent.status, agent.phase)}
                  />
                  {isLead && (
                    <Crown className="w-2.5 h-2.5 flex-shrink-0" style={{ color, opacity: 0.7 }} />
                  )}
                  {agent.name}
                  {agent.permissionMode === 'plan' && (
                    <span
                      className="text-[7px] font-bold uppercase tracking-wider px-1 rounded-sm flex-shrink-0"
                      style={{
                        background: 'color-mix(in srgb, var(--warning, #eab308) 20%, transparent)',
                        color: 'var(--warning, #eab308)',
                        lineHeight: '1.4',
                      }}
                    >
                      Plan
                    </span>
                  )}
                </button>
              </PopoverAnchor>

              {/* Actions popover — augmented-ui styled, replaces context menu */}
              {hasActions && (
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={6}
                  className="border-none rounded-none shadow-none p-0 bg-transparent w-auto overflow-visible"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <div
                    className="min-w-[120px] p-1 space-y-0.5"
                    data-augmented-ui="tl-clip br-clip border"
                    style={{
                      '--aug-tl': '6px',
                      '--aug-br': '6px',
                      '--aug-border-all': '1px',
                      '--aug-border-bg': color,
                      background: 'var(--surface)',
                    } as React.CSSProperties}
                  >
                    {/* Alive: Mode toggle, Restart (soft), Clear, Kill */}
                    {isAlive && (
                      <>
                        {agent.permissionMode === 'plan' ? (
                          <ActionItem
                            icon={<Pencil className="w-3 h-3" />}
                            label="Code Mode"
                            color={color}
                            onClick={() => doAction(() => setAgentMode(agent.id, 'default'))}
                          />
                        ) : (
                          <ActionItem
                            icon={<Eye className="w-3 h-3" />}
                            label="Plan Mode"
                            color={color}
                            onClick={() => doAction(() => setAgentMode(agent.id, 'plan'))}
                          />
                        )}
                        <ActionSeparator />
                        <ActionItem
                          icon={<RotateCw className="w-3 h-3" />}
                          label="Restart"
                          color={color}
                          onClick={() => doAction(() => restartAgent(agent.id))}
                        />
                        <ActionItem
                          icon={<Eraser className="w-3 h-3" />}
                          label="Clear"
                          color={color}
                          onClick={() => doAction(() => clearAgentSession(agent.id))}
                        />
                        <ActionSeparator />
                        <ActionItem
                          icon={<Square className="w-3 h-3" />}
                          label="Kill"
                          color="var(--destructive, #ef4444)"
                          onClick={() => doAction(() => killAgent(agent.id))}
                        />
                      </>
                    )}
                    {/* Error: Restart (hard), Kill, Remove */}
                    {agent.status === 'error' && (
                      <>
                        <ActionItem
                          icon={<RotateCw className="w-3 h-3" />}
                          label="Restart"
                          color={color}
                          onClick={() => doAction(() => hardRestartAgent(agent.id))}
                        />
                        <ActionSeparator />
                        <ActionItem
                          icon={<Square className="w-3 h-3" />}
                          label="Kill"
                          color="var(--destructive, #ef4444)"
                          onClick={() => doAction(() => killAgent(agent.id))}
                        />
                        <ActionItem
                          icon={<Trash2 className="w-3 h-3" />}
                          label="Remove"
                          color="var(--destructive, #ef4444)"
                          onClick={() => doAction(() => removeAgent(agent.id))}
                        />
                      </>
                    )}
                    {/* Stopped: Start, Remove */}
                    {agent.status === 'stopped' && (
                      <>
                        <ActionItem
                          icon={<Play className="w-3 h-3" />}
                          label="Start"
                          color={color}
                          onClick={() => doAction(() => startAgent(agent.id))}
                        />
                        <ActionSeparator />
                        <ActionItem
                          icon={<Trash2 className="w-3 h-3" />}
                          label="Remove"
                          color="var(--destructive, #ef4444)"
                          onClick={() => doAction(() => removeAgent(agent.id))}
                        />
                      </>
                    )}
                    {/* Deploying: only Kill */}
                    {agent.status === 'deploying' && (
                      <ActionItem
                        icon={<Square className="w-3 h-3" />}
                        label="Kill"
                        color="var(--destructive, #ef4444)"
                        onClick={() => doAction(() => killAgent(agent.id))}
                      />
                    )}
                  </div>
                </PopoverContent>
              )}
            </Popover>

            {/* Pending question badge — outside augmented-ui to avoid clip-path */}
            {hasPendingQuestion && (
              <span
                className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full pointer-events-none"
                style={{
                  background: 'var(--accent)',
                  boxShadow: '0 0 4px var(--accent)',
                  animation: 'border-pulse 2s ease-in-out infinite',
                }}
              />
            )}
          </div>
        );
      })}

      {/* Config gear (only when an agent is selected) */}
      {selectedAgentId && onOpenConfig && (
        <button
          onClick={onOpenConfig}
          className="flex items-center gap-1 px-1.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 hover:text-accent transition-colors"
          title="Agent config"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Deploy button */}
      <button
        onClick={() => setDeployDialogOpen(true)}
        className="flex items-center gap-1 px-1.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 hover:text-accent transition-colors"
        title="Deploy agent"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Action popover items ──

function ActionItem({
  icon,
  label,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider rounded-sm transition-colors hover:bg-foreground/5"
      style={{ color }}
    >
      {icon}
      {label}
    </button>
  );
}

function ActionSeparator() {
  return (
    <div
      className="h-px mx-1 my-0.5"
      style={{ background: 'color-mix(in srgb, var(--foreground) 6%, transparent)' }}
    />
  );
}
