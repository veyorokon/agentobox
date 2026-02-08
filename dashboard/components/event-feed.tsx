'use client';

import { useRef, useState, useEffect } from 'react';
import { useProjectsStore } from '@/stores/projects';
import { useEventsStore } from '@/stores/events';
import type { AgentEvent } from '@/types';

const EMPTY_EVENTS: AgentEvent[] = [];

/** Stable hue derived from agent name so each agent gets a consistent color. */
const AGENT_COLORS = [
  'hsl(190, 80%, 65%)', // cyan
  'hsl(280, 70%, 70%)', // purple
  'hsl(45, 90%, 65%)', // gold
  'hsl(140, 60%, 60%)', // green
  'hsl(350, 70%, 65%)', // rose
  'hsl(220, 70%, 70%)', // blue
  'hsl(25, 80%, 65%)', // orange
  'hsl(170, 60%, 55%)', // teal
];

function agentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

const EVENT_META: Record<string, { label: string; dim: boolean }> = {
  SessionStart: { label: 'START', dim: false },
  SessionEnd: { label: 'END', dim: false },
  Stop: { label: 'STOP', dim: false },
  PostToolUse: { label: 'TOOL', dim: true },
  TaskCompleted: { label: 'DONE', dim: false },
  SubagentStart: { label: 'SPAWN', dim: false },
  SubagentStop: { label: 'EXIT', dim: false },
  TeammateIdle: { label: 'IDLE', dim: true },
  Notification: { label: 'NOTE', dim: false },
  inbound_message: { label: 'MSG\u25B8', dim: false },
  outbound_message: { label: 'MSG\u25C2', dim: false },
  status_change: { label: 'STATUS', dim: false },
};

function formatEventContent(event: AgentEvent): string {
  const { data, eventType } = event;

  // Message events — show message content
  if (typeof data?.message === 'string') return data.message;

  // Tool events — show tool name
  if (
    eventType === 'PostToolUse' &&
    typeof data?.tool_name === 'string'
  ) {
    return data.tool_name as string;
  }

  // Status events
  if (typeof data?.status === 'string') return data.status as string;

  return eventType;
}

export function EventFeed({
  filter,
  onSelectAgent,
}: {
  filter: string;
  onSelectAgent: (name: string) => void;
}) {
  const projectId = useProjectsStore((s) => s.currentProjectId);
  const events = useEventsStore((s) =>
    projectId ? (s.events[projectId] ?? EMPTY_EVENTS) : EMPTY_EVENTS
  );

  const feedRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  useEffect(() => {
    if (!userScrolled && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events.length, userScrolled]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setUserScrolled(!atBottom);
  };

  const filtered = filter
    ? events.filter(
        (e) =>
          e.agentName.toLowerCase().includes(filter.toLowerCase()) ||
          e.eventType.toLowerCase().includes(filter.toLowerCase()) ||
          JSON.stringify(e.data).toLowerCase().includes(filter.toLowerCase())
      )
    : events;

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <span className="text-muted-foreground text-[10px] font-mono uppercase tracking-wider">
          {filter ? 'No matching events' : 'Awaiting events'}
        </span>
        {!filter && <span className="empty-cursor" />}
      </div>
    );
  }

  return (
    <div
      ref={feedRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto scrollbar-thin py-1"
    >
      {filtered.map((event, i) => {
        const color = agentColor(event.agentName);
        const meta = EVENT_META[event.eventType] || {
          label: event.eventType.slice(0, 6).toUpperCase(),
          dim: false,
        };
        const content = formatEventContent(event);
        const isMessage =
          event.eventType === 'inbound_message' ||
          event.eventType === 'outbound_message';
        const prevAgent = i > 0 ? filtered[i - 1].agentName : null;
        const isNewGroup = event.agentName !== prevAgent;

        const time = event.createdAt
          ? new Date(event.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          : '';

        return (
          <div
            key={event.id}
            style={{
              borderLeft: `3px solid ${color}`,
              marginLeft: '12px',
              marginTop: isNewGroup && i > 0 ? '6px' : '0',
              opacity: meta.dim ? 0.5 : 1,
            }}
          >
            {/* Agent name header on group start */}
            {isNewGroup && (
              <div className="flex items-center gap-2 pl-3 pt-1 pb-0.5">
                <button
                  onClick={() => onSelectAgent(event.agentName)}
                  className="text-[10px] font-mono font-bold uppercase tracking-wider hover:underline transition-colors"
                  style={{ color }}
                >
                  {event.agentName}
                </button>
                <div
                  className="flex-1 h-px"
                  style={{
                    background: `color-mix(in srgb, ${color} 15%, transparent)`,
                  }}
                />
              </div>
            )}

            {/* Event content row */}
            <div
              className={`flex items-start gap-2 pl-3 pr-4 py-0.5 hover:bg-surface-inset/30 transition-colors ${
                isMessage ? 'bg-surface-inset/10' : ''
              }`}
            >
              <span className="text-muted-foreground/40 text-[9px] font-mono w-[56px] flex-shrink-0 pt-px tabular-nums">
                {time}
              </span>
              <span
                className="text-[8px] font-mono font-bold uppercase tracking-wider w-10 flex-shrink-0 pt-px"
                style={{
                  color: isMessage ? color : 'var(--muted-foreground)',
                }}
              >
                {meta.label}
              </span>
              <span
                className={`text-xs font-mono truncate flex-1 pt-px ${
                  isMessage
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {content}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
