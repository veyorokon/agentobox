'use client';

import { useRef, useState, useEffect } from 'react';
import type { AgentEvent } from '@/types';
import { STATUS_COLOR_VAR } from './status-badge';
import type { AgentStatus } from '@/types';

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function EventFeed({
  events,
  filter,
  onSelectAgent,
}: {
  events: AgentEvent[];
  filter: string;
  onSelectAgent: (name: string) => void;
}) {
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
          e.agent.name.toLowerCase().includes(filter.toLowerCase()) ||
          e.eventType.toLowerCase().includes(filter.toLowerCase()) ||
          JSON.stringify(e.data).toLowerCase().includes(filter.toLowerCase())
      )
    : events;

  const sorted = [...filtered].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp)
  );

  if (sorted.length === 0) {
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
      {sorted.map((event, i) => {
        const eventStatus = (event.data?.status as AgentStatus) ?? 'working';
        const color = STATUS_COLOR_VAR[eventStatus] ?? 'var(--muted-foreground)';
        const message =
          typeof event.data?.message === 'string'
            ? event.data.message
            : event.eventType;

        return (
          <div
            key={`${event.id}-${i}`}
            className="flex items-start gap-2 px-5 py-1.5 hover:bg-surface-inset/50 transition-colors group"
          >
            <span className="text-muted-foreground text-[10px] font-mono w-14 flex-shrink-0 pt-px">
              {formatEventTime(event.timestamp)}
            </span>
            <button
              onClick={() => onSelectAgent(event.agent.name)}
              className="text-[11px] font-mono font-bold w-16 flex-shrink-0 truncate text-left hover:underline pt-px"
              style={{ color }}
            >
              {event.agent.name}
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
