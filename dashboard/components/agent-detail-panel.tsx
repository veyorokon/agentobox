'use client';

import { ArrowLeft, RotateCw, Trash2 } from 'lucide-react';
import { useAgentsStore, type DetailTab } from '@/stores/agents';
import { useMessagesStore } from '@/stores/messages';
import { STATUS_COLOR_VAR } from './status-badge';
import { VncFrame } from './vnc-frame';
import { ChatView } from './chat-view';
import { ConfigView } from './config-view';
import type { Agent, Message } from '@/types';

const EMPTY_MESSAGES: Record<string, Message> = {};

interface AgentDetailPanelProps {
  agent: Agent;
  onBack: () => void;
  onRestart?: () => void;
  onStop?: () => void;
}

export function AgentDetailPanel({
  agent,
  onBack,
  onRestart,
  onStop,
}: AgentDetailPanelProps) {
  const detailTab = useAgentsStore((s) => s.detailTab);
  const setDetailTab = useAgentsStore((s) => s.setDetailTab);
  const agentMessages = useMessagesStore((s) => s.byAgent);
  const messages = agentMessages[agent.id] ?? EMPTY_MESSAGES;

  const statusColor = STATUS_COLOR_VAR[agent.status];

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center gap-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* Back button */}
        <button
          onClick={onBack}
          data-augmented-ui="tl-clip br-clip border"
          className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          style={{
            '--aug-tl': '6px',
            '--aug-br': '6px',
            '--aug-border-all': '1px',
            '--aug-border-bg': 'var(--border)',
          } as React.CSSProperties}
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Agent info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-lg font-mono font-bold truncate"
              style={{ color: statusColor }}
            >
              {agent.name}
            </span>
            <span
              className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                color: statusColor,
                background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
              }}
            >
              {agent.status}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-mono text-muted-foreground">
              {agent.runtime}
            </span>
            {agent.sessionCostUsd !== null && (
              <>
                <span className="text-[10px] text-muted-foreground/50">&middot;</span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  ${Number(agent.sessionCostUsd || 0).toFixed(3)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {onRestart && (
            <button
              onClick={onRestart}
              data-augmented-ui="tl-clip br-clip border"
              className="px-3 py-2 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              style={{
                '--aug-tl': '5px',
                '--aug-br': '5px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
              title="Restart"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
                Restart
              </span>
            </button>
          )}
          {onStop && (
            <button
              onClick={onStop}
              data-augmented-ui="tl-clip br-clip border"
              className="px-3 py-2 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              style={{
                '--aug-tl': '5px',
                '--aug-br': '5px',
                '--aug-border-all': '1px',
                '--aug-border-bg': 'var(--border)',
              } as React.CSSProperties}
              title="Stop"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
                Stop
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        className="px-5 py-3 flex items-center gap-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {(['desktop', 'chat', 'config'] as const).map((tab) => {
          const isActive = detailTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              data-augmented-ui={isActive ? 'tl-clip br-clip border' : ''}
              className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
              style={
                isActive
                  ? ({
                      '--aug-tl': '5px',
                      '--aug-br': '5px',
                      '--aug-border-all': '1px',
                      '--aug-border-bg': statusColor,
                      color: statusColor,
                    } as React.CSSProperties)
                  : { color: 'var(--muted-foreground)' }
              }
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {detailTab === 'desktop' && <VncFrame url={agent.vncUrl} />}
        {detailTab === 'chat' && (
          <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-thin flex flex-col-reverse">
            <ChatView agent={agent} messages={messages} />
          </div>
        )}
        {detailTab === 'config' && <ConfigView agent={agent} />}
      </div>
    </div>
  );
}
