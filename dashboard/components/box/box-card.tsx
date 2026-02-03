'use client';

import Link from 'next/link';
import type { Agent } from '@/types';
import { formatRelativeTime } from '@/lib/mock-data';
import { Bot, Clock, AlertCircle, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface BoxCardProps {
  agent: Agent;
  bentoId: string;
}

const STATUS_ICONS = {
  idle: Clock,
  working: Loader2,
  completed: CheckCircle,
  blocked: AlertCircle,
  dead: XCircle,
};

// Vibrant card colors matching the playful bento aesthetic
const CARD_STYLES = {
  idle: {
    bg: 'bg-slate-200',
    icon: 'bg-slate-400',
    text: 'text-gray-800',
    subtext: 'text-gray-600',
    badge: 'bg-slate-400 text-white',
  },
  working: {
    bg: 'bg-cyan-400',
    icon: 'bg-cyan-600',
    text: 'text-gray-900',
    subtext: 'text-cyan-800',
    badge: 'bg-cyan-600 text-white',
  },
  completed: {
    bg: 'bg-emerald-200',
    icon: 'bg-emerald-500',
    text: 'text-gray-900',
    subtext: 'text-emerald-800',
    badge: 'bg-emerald-500 text-white',
  },
  blocked: {
    bg: 'bg-amber-300',
    icon: 'bg-amber-600',
    text: 'text-gray-900',
    subtext: 'text-amber-800',
    badge: 'bg-amber-600 text-white',
  },
  dead: {
    bg: 'bg-red-300',
    icon: 'bg-red-600',
    text: 'text-gray-900',
    subtext: 'text-red-800',
    badge: 'bg-red-600 text-white',
  },
};

export function BoxCard({ agent, bentoId }: BoxCardProps) {
  const styles = CARD_STYLES[agent.status];
  const StatusIcon = STATUS_ICONS[agent.status];

  return (
    <Link href={`/bento/${bentoId}/${agent.name}`}>
      <div
        className={`${styles.bg} rounded-3xl p-5 hover:scale-[1.02] transition-all duration-200 cursor-pointer group min-h-[180px] flex flex-col shadow-lg hover:shadow-xl`}
        style={{
          boxShadow: '0 8px 0 rgba(0,0,0,0.1), 0 12px 20px rgba(0,0,0,0.15)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-2xl ${styles.icon} flex items-center justify-center shadow-md`}
            >
              <Bot className="w-6 h-6 text-white" />
            </div>
            <h3 className={`font-bold uppercase text-lg ${styles.text}`}>{agent.name}</h3>
          </div>
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${styles.badge}`}
          >
            <StatusIcon
              className={`w-3.5 h-3.5 ${agent.status === 'working' ? 'animate-spin' : ''}`}
            />
            <span className="capitalize">{agent.status}</span>
          </div>
        </div>

        {/* Message */}
        <div className="flex-1">
          <p className={`text-sm ${styles.subtext} line-clamp-2 font-medium`}>{agent.message}</p>
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between mt-3 pt-3 border-t border-black/10`}>
          <span className={`text-xs font-semibold ${styles.subtext}`}>
            Active {formatRelativeTime(agent.lastActivity)}
          </span>
          <svg
            className={`w-5 h-5 ${styles.subtext} group-hover:translate-x-1 transition-transform`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
