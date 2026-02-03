'use client';

import { use } from 'react';
import Link from 'next/link';
import { useBentoStore, useEventStore } from '@/stores';
import { EventFilters } from '@/components/events/event-filters';
import { EventFeed } from '@/components/events/event-feed';
import { ArrowLeft, Activity, Grid } from 'lucide-react';

interface EventsPageProps {
  params: Promise<{ id: string }>;
}

export default function EventsPage({ params }: EventsPageProps) {
  const { id } = use(params);
  const bento = useBentoStore((s) => s.getBento(id));
  const events = useEventStore((s) => s.events[id] ?? []);

  if (!bento) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-[#c0c5ce] mb-2">Bento not found</h2>
          <p className="text-[#65737e] mb-4">The bento you're looking for doesn't exist.</p>
          <Link
            href="/"
            className="text-[#e59758] hover:text-[#ebcb8b] inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to bentos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Link
            href="/"
            className="p-2 hover:bg-[#363c4a] rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[#65737e]" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#c0c5ce]">{bento.name}</h1>
            <p className="text-[#65737e] text-sm">{events.length} events recorded</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <Link
            href={`/bento/${id}`}
            className="px-4 py-2 text-[#65737e] hover:bg-[#363c4a] rounded-full text-sm font-medium transition-colors inline-flex items-center gap-2"
          >
            <Grid className="w-4 h-4" />
            Agents
          </Link>
          <Link
            href={`/bento/${id}/events`}
            className="px-4 py-2 bg-[#e59758] text-[#2b303b] rounded-full text-sm font-medium inline-flex items-center gap-2 shadow-md"
          >
            <Activity className="w-4 h-4" />
            Events
          </Link>
        </div>
      </div>

      {/* Filters */}
      <EventFilters bentoId={id} />

      {/* Event Feed */}
      <div className="flex-1 overflow-auto">
        <EventFeed bentoId={id} />
      </div>
    </div>
  );
}
