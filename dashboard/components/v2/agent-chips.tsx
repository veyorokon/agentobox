'use client';

import { Plus, Crown, Code2, Image, RotateCw, Square, Play, Eraser, Trash2, Monitor, Settings2 } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentsStore } from '@/stores/agents';
import { useFeedStore } from '@/stores/feed';
import { useAgentActions } from '@/hooks/use-agent-actions';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { FeedItem } from '@/lib/mock-v2-data';

function chipDotStyle(status: string): React.CSSProperties {
  switch (status) {
    case 'deploying':
      return {
        background: 'var(--agent-deploying)',
        boxShadow: 'none',
        animation: 'border-pulse 1.5s ease-in-out infinite',
      };
    case 'running':
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
  const { restartAgent, hardRestartAgent, startAgent, clearAgentSession, killAgent, removeAgent } = useAgentActions();

  const pendingQuestionAgents = getAgentsWithPendingQuestions(feedItems);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* All chip */}
      <button
        onClick={() => setSelectedAgent(null)}
        className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
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

        return (
          <div key={agent.id} className="relative">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
                  className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
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
                    style={chipDotStyle(agent.status)}
                  />
                  {isLead && (
                    <Crown className="w-2.5 h-2.5 flex-shrink-0" style={{ color, opacity: 0.7 }} />
                  )}
                  {agent.name}
                  <Monitor
                    className="w-2.5 h-2.5 flex-shrink-0"
                    style={{ opacity: isSelected ? 0.5 : 0.2 }}
                  />
                </button>
              </ContextMenuTrigger>
              {(isAlive || isDead || agent.status === 'deploying') && (
                <ContextMenuContent className="min-w-[120px] font-mono text-[10px]">
                  {/* Alive: Restart (soft), Clear, separator, Kill */}
                  {isAlive && (
                    <>
                      <ContextMenuItem
                        onClick={() => restartAgent(agent.id)}
                        className="gap-2 text-[10px]"
                      >
                        <RotateCw className="w-3 h-3" />
                        Restart
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => clearAgentSession(agent.id)}
                        className="gap-2 text-[10px]"
                      >
                        <Eraser className="w-3 h-3" />
                        Clear
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => killAgent(agent.id)}
                        className="gap-2 text-[10px]"
                      >
                        <Square className="w-3 h-3" />
                        Kill
                      </ContextMenuItem>
                    </>
                  )}
                  {/* Error: Restart (hard), separator, Kill */}
                  {agent.status === 'error' && (
                    <>
                      <ContextMenuItem
                        onClick={() => hardRestartAgent(agent.id)}
                        className="gap-2 text-[10px]"
                      >
                        <RotateCw className="w-3 h-3" />
                        Restart
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => killAgent(agent.id)}
                        className="gap-2 text-[10px]"
                      >
                        <Square className="w-3 h-3" />
                        Kill
                      </ContextMenuItem>
                    </>
                  )}
                  {/* Stopped: Start, separator, Remove */}
                  {agent.status === 'stopped' && (
                    <>
                      <ContextMenuItem
                        onClick={() => startAgent(agent.id)}
                        className="gap-2 text-[10px]"
                      >
                        <Play className="w-3 h-3" />
                        Start
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => removeAgent(agent.id)}
                        className="gap-2 text-[10px]"
                      >
                        <Trash2 className="w-3 h-3" />
                        Remove
                      </ContextMenuItem>
                    </>
                  )}
                  {/* Deploying: only Kill */}
                  {agent.status === 'deploying' && (
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => killAgent(agent.id)}
                      className="gap-2 text-[10px]"
                    >
                      <Square className="w-3 h-3" />
                      Kill
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              )}
            </ContextMenu>

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
