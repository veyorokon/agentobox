'use client';

import type { Bento } from '@/types';
import { BentoCard } from './bento-card';

interface BentoListProps {
  bentos: Bento[];
}

export function BentoList({ bentos }: BentoListProps) {
  if (bentos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 bg-[#343d46] rounded-2xl flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-[#65737e]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-[#c0c5ce] mb-2">No bentos yet</h3>
        <p className="text-[#65737e] max-w-sm">
          Create your first bento to start orchestrating AI agents
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-2">
      {bentos.map((bento) => (
        <BentoCard key={bento.id} bento={bento} />
      ))}
    </div>
  );
}
