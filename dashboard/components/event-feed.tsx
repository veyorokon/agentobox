'use client';

import { useRef, useState, useEffect } from 'react';
import { useProjectsStore } from '@/stores/projects';
import { useEventsStore } from '@/stores/events';
import { STATUS_COLOR_VAR } from './status-badge';
import type { AgentEvent, AgentStatus } from '@/types';

const EMPTY_EVENTS: AgentEvent[] = [];

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
        const eventStatus = (event.data?.status as AgentStatus) ?? 'running';
        const color = STATUS_COLOR_VAR[eventStatus] ?? 'var(--muted-foreground)';
        const message =
          typeof event.data?.message === 'string'
            ? event.data.message
            : event.eventType;

        return (
          <div
            key={i}
            className="flex items-start gap-2 px-5 py-1.5 hover:bg-surface-inset/50 transition-colors group"
          >
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
