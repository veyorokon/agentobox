'use client';

import { useMemo } from 'react';
import { useEventStore } from '@/stores';
import { EventRow } from './event-row';
import { Activity } from 'lucide-react';

interface EventFeedProps {
  bentoId: string;
}

export function EventFeed({ bentoId }: EventFeedProps) {
  // Select raw data separately to avoid creating new references
  const allEvents = useEventStore((s) => s.events[bentoId] ?? []);
  const filters = useEventStore((s) => s.filters);

  // Filter in component with useMemo for stable reference
  const events = useMemo(() => {
    return allEvents.filter((event) => {
      if (filters.agents.length > 0 && !filters.agents.includes(event.agent)) {
        return false;
      }
      if (filters.states.length > 0 && !filters.states.includes(event.state)) {
        return false;
      }
      return true;
    });
  }, [allEvents, filters]);

  if (events.length === 0) {
    return (
      <div className="bg-[#343d46] rounded-2xl p-8 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 bg-[#4f5b66] rounded-xl flex items-center justify-center mb-3">
          <Activity className="w-6 h-6 text-[#65737e]" />
        </div>
        <h3 className="text-lg font-semibold text-[#c0c5ce] mb-1">No events</h3>
        <p className="text-[#65737e] text-sm">
          No events match your current filters.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#343d46] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-[#4f5b66] text-xs font-semibold text-[#65737e]">
        <span className="w-20">TIME</span>
        <span className="w-32 text-center">AGENT</span>
        <span className="w-24 text-center">STATE</span>
        <span className="flex-1">MESSAGE</span>
      </div>

      {/* Events List */}
      <div className="max-h-[600px] overflow-y-auto">
        {events.map((event, i) => (
          <EventRow key={`${event.ts}-${event.agent}-${i}`} event={event} isOdd={i % 2 === 1} />
        ))}
      </div>
    </div>
  );
}
