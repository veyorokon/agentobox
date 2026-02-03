'use client';

import type { AgentEvent, AgentStatus } from '@/types';
import { STATE_COLORS } from '@/lib/constants';

interface EventRowProps {
  event: AgentEvent;
  isOdd: boolean;
}

export function EventRow({ event, isOdd }: EventRowProps) {
  const colors = STATE_COLORS[event.state as AgentStatus];

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
    <div
      className={`flex items-center gap-4 px-4 py-3 ${
        isOdd ? 'bg-[#2b303b]/50' : 'bg-transparent'
      }`}
    >
      {/* Timestamp */}
      <span className="text-xs text-[#65737e] font-mono w-20 flex-shrink-0">
        {formatTime(event.ts)}
      </span>

      {/* Agent Badge */}
      <span className="px-3 py-1 rounded-full bg-[#4f5b66] text-xs font-medium text-[#c0c5ce] w-32 text-center truncate">
        {event.agent}
      </span>

      {/* State Badge */}
      <span
        className={`px-2.5 py-1 rounded text-xs font-medium ${colors.bg} text-[#2b303b] w-24 text-center capitalize`}
      >
        {event.state}
      </span>

      {/* Message */}
      <span className="text-sm text-[#c0c5ce] flex-1 truncate">{event.msg}</span>
    </div>
  );
}
