'use client';

import { useState } from 'react';
import { User, Activity, ArrowUp } from 'lucide-react';
import type { Agent, AgentStatus } from '@/types';

const statusColors: Record<AgentStatus, { bg: string; text: string; glow: string }> = {
  working: { bg: 'bg-cyan-500', text: 'text-cyan-400', glow: 'shadow-cyan-500/30' },
  completed: { bg: 'bg-emerald-500', text: 'text-emerald-400', glow: 'shadow-emerald-500/30' },
  idle: { bg: 'bg-gray-500', text: 'text-gray-400', glow: 'shadow-gray-500/30' },
  blocked: { bg: 'bg-amber-500', text: 'text-amber-400', glow: 'shadow-amber-500/30' },
  dead: { bg: 'bg-red-500', text: 'text-red-400', glow: 'shadow-red-500/30' },
};

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const [message, setMessage] = useState('');
  const status = statusColors[agent.status];

  return (
    <div
      className="bg-gray-900 rounded-[2rem] p-6 shadow-2xl shadow-black/40 hover:shadow-black/50 hover:-translate-y-1 transition-all duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${status.bg} shadow-lg ${status.glow} flex items-center justify-center`}>
            <span className="text-white text-sm font-bold uppercase">
              {agent.name.slice(0, 2)}
            </span>
          </div>
          <div>
            <h3 className="text-white font-bold text-lg capitalize">{agent.name}</h3>
            <span className={`text-xs font-semibold ${status.text} uppercase tracking-wide`}>
              {agent.status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white/50 text-sm font-medium">LIVE</span>
        </div>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-2 gap-4">
        {/* Neural Stream / Chat */}
        <div className="bg-violet-200 rounded-2xl p-4 flex flex-col min-h-[280px]">
          <h4 className="text-sm font-bold text-gray-900 mb-3">NEURAL STREAM</h4>

          <div className="flex-1 space-y-3 overflow-y-auto">
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-gray-800" />
              </div>
              <div className="bg-white rounded-xl rounded-tl-sm px-3 py-2 text-sm text-gray-800 shadow-sm">
                Start the task...
              </div>
            </div>

            {agent.message && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                  <Activity className="w-4 h-4 text-white" />
                </div>
                <div className="bg-white rounded-xl rounded-tl-sm px-3 py-2 text-sm text-gray-800 shadow-sm">
                  {agent.message}
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 bg-white/60 rounded-full px-3 py-2">
            <input
              type="text"
              placeholder="Type a message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none"
            />
            <button className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center hover:bg-amber-500 transition-colors">
              <ArrowUp className="w-4 h-4 text-gray-800" />
            </button>
          </div>
        </div>

        {/* Agent's Eye */}
        <div className="bg-gray-800 rounded-2xl p-4 flex flex-col min-h-[280px]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-white">AGENT'S EYE</h4>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-white/50">LIVE</span>
            </div>
          </div>

          {/* Browser chrome */}
          <div className="flex-1 bg-gray-900 rounded-xl overflow-hidden flex flex-col">
            <div className="bg-gray-700 px-3 py-2 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              </div>
              <div className="flex-1 bg-gray-600 rounded px-2 py-1">
                <span className="text-gray-400 text-xs">agentbox.app</span>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-700 flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500 max-w-[150px]">
                  {agent.message || 'Waiting for activity...'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
