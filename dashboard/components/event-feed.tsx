'use client';

import { useRef, useState, useEffect } from 'react';
import { useProjectsStore } from '@/stores/projects';
import { useEventsStore } from '@/stores/events';
import type { AgentEvent } from '@/types';

const EMPTY_EVENTS: AgentEvent[] = [];

/** Stable hue derived from agent name so each agent gets a consistent color. */
const AGENT_COLORS = [
  'hsl(190, 80%, 65%)',  // cyan
  'hsl(280, 70%, 70%)',  // purple
  'hsl(45, 90%, 65%)',   // gold
  'hsl(140, 60%, 60%)',  // green
  'hsl(350, 70%, 65%)',  // rose
  'hsl(220, 70%, 70%)',  // blue
  'hsl(25, 80%, 65%)',   // orange
  'hsl(170, 60%, 55%)',  // teal
];

function agentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
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
      <div className="flex items-center justify-center h-32">
        <p className="text-muted-foreground text-xs text-center">
          {filter ? 'No matching events' : 'No events yet'}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={feedRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto scrollbar-thin"
    >
      {filtered.map((event, i) => {
        const color = agentColor(event.agentName);
        const message =
          typeof event.data?.message === 'string'
            ? event.data.message
            : event.eventType;
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
            className="flex items-start gap-2 px-5 py-1.5 hover:bg-surface-inset/50 transition-colors group"
          >
            <span className="text-muted-foreground/50 text-[10px] font-mono w-[62px] flex-shrink-0 pt-px">
              {time}
            </span>
            <button
              onClick={() => onSelectAgent(event.agentName)}
              className="text-[11px] font-mono font-bold w-16 flex-shrink-0 truncate text-left hover:underline pt-px"
              style={{ color }}
            >
              {event.agentName}
            </button>
            <span className="text-foreground text-xs font-mono truncate pt-px">
              {message}
            </span>
          </div>
        );
      })}
    </div>
  );
}
