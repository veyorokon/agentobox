'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Agent } from '@/types';
import { Bot, Clock, AlertCircle, CheckCircle, XCircle, Loader2, X, ArrowUp } from 'lucide-react';

// Import the bento widgets
import { NeuralStream } from '@/components/neural-stream';
import { AgentEye } from '@/components/agent-eye';
import { Heartbeat } from '@/components/heartbeat';
import { Backpack } from '@/components/backpack';
import { Cost } from '@/components/cost';
import { StopPause } from '@/components/stop-pause';

interface BoxExpandableProps {
  agent: Agent;
  bentoId: string;
  isExpanded: boolean;
  onToggle: () => void;
}

const STATUS_ICONS = {
  idle: Clock,
  working: Loader2,
  completed: CheckCircle,
  blocked: AlertCircle,
  dead: XCircle,
};

// Bliss-themed card styles - same bg with colored status badges only
const CARD_STYLES = {
  idle: {
    bg: 'bg-[#2b303b]',
    badge: 'bg-[#4f5b66] text-[#c0c5ce]',
    text: 'text-[#c0c5ce]',
    subtext: 'text-[#65737e]',
  },
  working: {
    bg: 'bg-[#2b303b]',
    badge: 'bg-[#96b5b4] text-[#2b303b]',
    text: 'text-[#c0c5ce]',
    subtext: 'text-[#65737e]',
  },
  completed: {
    bg: 'bg-[#2b303b]',
    badge: 'bg-[#a3be8c] text-[#2b303b]',
    text: 'text-[#c0c5ce]',
    subtext: 'text-[#65737e]',
  },
  blocked: {
    bg: 'bg-[#2b303b]',
    badge: 'bg-[#ebcb8b] text-[#2b303b]',
    text: 'text-[#c0c5ce]',
    subtext: 'text-[#65737e]',
  },
  dead: {
    bg: 'bg-[#2b303b]',
    badge: 'bg-[#bf616a] text-white',
    text: 'text-[#c0c5ce]',
    subtext: 'text-[#65737e]',
  },
};

export function BoxExpandable({ agent, bentoId, isExpanded, onToggle }: BoxExpandableProps) {
  const [message, setMessage] = useState('');
  const styles = CARD_STYLES[agent.status];
  const StatusIcon = STATUS_ICONS[agent.status];

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (message.trim()) {
      // TODO: Wire up to chat store
      console.log(`Message to ${agent.name}:`, message);
      setMessage('');
    }
  };

  return (
    <motion.div
      layout
      layoutId={`box-${agent.name}`}
      onClick={!isExpanded ? onToggle : undefined}
      className={`
        ${isExpanded ? 'fixed inset-4 z-50' : 'relative cursor-pointer'}
      `}
      style={{ originX: 0.5, originY: 0.5 }}
      transition={{
        layout: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
      }}
    >
      <motion.div
        layout
        className={`
          ${styles.bg} rounded-3xl overflow-hidden h-full
        `}
        style={{
          boxShadow: isExpanded
            ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            : '0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(79,91,102,0.2)',
        }}
      >
        {!isExpanded ? (
          // Collapsed Card - Minimal with shadow depth
          <motion.div layout className="flex flex-col h-full min-h-[300px]">
            {/* Header */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <motion.div
                    layoutId={`box-icon-${agent.name}`}
                    className="w-9 h-9 rounded-xl bg-[#343d46] flex items-center justify-center"
                  >
                    <Bot className="w-5 h-5 text-[#c0c5ce]" />
                  </motion.div>
                  <motion.h3
                    layoutId={`box-title-${agent.name}`}
                    className={`font-bold uppercase text-base ${styles.text}`}
                  >
                    {agent.name}
                  </motion.h3>
                </div>
                <div
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${styles.badge}`}
                >
                  <StatusIcon
                    className={`w-3 h-3 ${agent.status === 'working' ? 'animate-spin' : ''}`}
                  />
                  <span className="capitalize">{agent.status}</span>
                </div>
              </div>
            </div>

            {/* Mini VNC Preview - Dark Bliss contrast */}
            <div className="flex-1 mx-3 my-2 bg-[#2b303b] rounded-2xl overflow-hidden">
              {/* Mini Browser Chrome */}
              <div className="bg-[#343d46] px-2 py-1.5 flex items-center gap-1.5">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-[#bf616a]" />
                  <div className="w-2 h-2 rounded-full bg-[#ebcb8b]" />
                  <div className="w-2 h-2 rounded-full bg-[#a3be8c]" />
                </div>
                <div className="flex-1 bg-[#4f5b66] rounded px-2 py-0.5 mx-1">
                  <span className="text-[#65737e] text-[10px]">{agent.name}.desktop</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#bf616a] animate-pulse" />
                  <span className="text-[10px] text-[#c0c5ce] font-medium">LIVE</span>
                </div>
              </div>

              {/* Mini Screen Content */}
              <div className="aspect-video bg-[#2b303b] flex items-center justify-center relative p-2">
                <div className="absolute inset-0 bg-gradient-to-br from-[#343d46]/50 to-[#2b303b]/50" />
                <div className="text-center z-10">
                  <div className="w-8 h-8 mx-auto mb-1 rounded-lg bg-[#343d46] flex items-center justify-center">
                    <svg className="w-4 h-4 text-[#65737e]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-[#65737e] text-[10px] line-clamp-2 px-2">{agent.message}</p>
                </div>
                {/* Scan lines */}
                <div
                  className="absolute inset-0 pointer-events-none opacity-5"
                  style={{
                    backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.03) 1px, rgba(255,255,255,0.03) 2px)',
                  }}
                />
              </div>
            </div>

            {/* Chat Input */}
            <div className="px-3 pb-3">
              <form
                onSubmit={handleSendMessage}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 bg-transparent rounded-full px-3 py-2 border border-[#4f5b66]"
              >
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your message..."
                  className="flex-1 bg-transparent outline-none text-sm text-white placeholder-[#65737e]"
                />
                <button
                  type="submit"
                  className="w-7 h-7 rounded-full bg-[#4f5b66] flex items-center justify-center hover:bg-[#65737e] transition-colors flex-shrink-0"
                >
                  <ArrowUp className="w-4 h-4 text-[#c0c5ce]" />
                </button>
              </form>
            </div>
          </motion.div>
        ) : (
          // Expanded Bento Box
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.2 }}
            className="h-full flex flex-col p-4"
          >
            {/* Header with close button */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <motion.div
                  layoutId={`box-icon-${agent.name}`}
                  className="w-12 h-12 rounded-2xl bg-amber-400 flex items-center justify-center shadow-md"
                >
                  <Bot className="w-6 h-6 text-gray-900" />
                </motion.div>
                <div>
                  <motion.h3
                    layoutId={`box-title-${agent.name}`}
                    className="font-bold uppercase text-xl text-white"
                  >
                    {agent.name}
                  </motion.h3>
                  <p className="text-gray-400 text-sm">{agent.message}</p>
                </div>
              </div>
              <button
                onClick={onToggle}
                className="p-2 hover:bg-gray-800 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            {/* Bento Grid Content */}
            <div className="flex-1 overflow-auto">
              <div className="flex flex-col lg:flex-row gap-3 h-full">
                {/* Left Column - Neural Stream */}
                <div className="lg:w-[340px] flex-shrink-0">
                  <NeuralStream />
                </div>

                {/* Right Column - Bento Grid */}
                <div className="flex-1 flex flex-col gap-3">
                  {/* Agent's Eye - Top */}
                  <AgentEye />

                  {/* Middle Row - Heartbeat + Backpack */}
                  <div className="grid grid-cols-2 gap-3">
                    <Heartbeat />
                    <Backpack />
                  </div>

                  {/* Bottom Row - Cost + Stop/Pause */}
                  <div className="grid grid-cols-2 gap-3">
                    <Cost />
                    <StopPause />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
