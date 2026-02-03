'use client';

import { useEventStore } from '@/stores';
import { STATE_COLORS } from '@/lib/constants';
import type { AgentStatus } from '@/types';
import { Clock } from 'lucide-react';

interface BoxEventsProps {
  bentoId: string;
  agentName: string;
}

export function BoxEvents({ bentoId, agentName }: BoxEventsProps) {
  const events = useEventStore((s) =>
    s.events[bentoId]?.filter((e) => e.agent === agentName).slice(0, 5) ?? []
  );

  const formatTime = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  return (
    <div className="bg-gray-800 rounded-3xl p-5 h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">RECENT EVENTS</h2>
        <Clock className="w-5 h-5 text-gray-500" />
      </div>

      {/* Events List */}
      <div className="space-y-2">
        {events.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No events yet</p>
        ) : (
          events.map((event, i) => {
            const colors = STATE_COLORS[event.state as AgentStatus];
            return (
              <div
                key={i}
                className="flex items-center gap-3 p-2 rounded-lg bg-gray-900/50"
              >
                <span className="text-xs text-gray-500 font-mono">
                  {formatTime(event.ts)}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} text-white`}
                >
                  {event.state}
                </span>
                <span className="text-sm text-gray-300 truncate flex-1">
                  {event.msg}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
