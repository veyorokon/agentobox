'use client';

import Link from 'next/link';
import type { Bento, Agent } from '@/types';
import { useAgentStore } from '@/stores';
import { formatRelativeTime, formatStatusSummary, countAgentsByStatus } from '@/lib/mock-data';
import { STATE_COLORS } from '@/lib/constants';

interface BentoCardProps {
  bento: Bento;
}

export function BentoCard({ bento }: BentoCardProps) {
  const agents = useAgentStore((s) => s.getAgentsForBento(bento.id));
  const counts = countAgentsByStatus(agents);

  return (
    <Link href={`/bento/${bento.id}`}>
      <div
        className="bg-[#2b303b] rounded-3xl p-6 hover:translate-y-[-2px] transition-all duration-200 cursor-pointer group"
        style={{
          boxShadow: '0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(79,91,102,0.2)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-xl font-bold text-[#c0c5ce] group-hover:text-[#e59758] transition-colors">
            {bento.name}
          </h3>
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                bento.agentoOnline ? 'bg-[#a3be8c] animate-pulse' : 'bg-[#65737e]'
              }`}
            />
            <span className="text-sm text-[#65737e]">
              {bento.agentoOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        {/* Agent Count */}
        <div className="mb-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#4f5b66] text-sm font-medium text-[#c0c5ce]">
            {agents.length} agent{agents.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Status Summary */}
        <div className="mb-4 text-sm">
          {counts.working > 0 && (
            <span className="text-[#96b5b4]">{counts.working} working</span>
          )}
          {counts.working > 0 && (counts.blocked > 0 || counts.completed > 0 || counts.idle > 0) && (
            <span className="text-[#65737e]">, </span>
          )}
          {counts.blocked > 0 && (
            <span className="text-[#ebcb8b]">{counts.blocked} blocked</span>
          )}
          {counts.blocked > 0 && (counts.completed > 0 || counts.idle > 0) && (
            <span className="text-[#65737e]">, </span>
          )}
          {counts.completed > 0 && (
            <span className="text-[#a3be8c]">{counts.completed} completed</span>
          )}
          {counts.completed > 0 && counts.idle > 0 && <span className="text-[#65737e]">, </span>}
          {counts.idle > 0 && (
            <span className="text-[#65737e]">{counts.idle} idle</span>
          )}
          {agents.length === 0 && <span className="text-[#65737e]">No agents yet</span>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-sm text-[#65737e]">
          <span>Last activity {formatRelativeTime(bento.lastActivity)}</span>
          <svg
            className="w-4 h-4 text-[#65737e] group-hover:text-[#e59758] group-hover:translate-x-1 transition-all"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
