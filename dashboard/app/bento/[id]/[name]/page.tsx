'use client';

import { use } from 'react';
import Link from 'next/link';
import { useBentoStore, useAgentStore } from '@/stores';
import { ArrowLeft } from 'lucide-react';

// Import the original colorful components
import { NeuralStream } from '@/components/neural-stream';
import { AgentEye } from '@/components/agent-eye';
import { Heartbeat } from '@/components/heartbeat';
import { Backpack } from '@/components/backpack';
import { Cost } from '@/components/cost';
import { StopPause } from '@/components/stop-pause';

interface BoxDetailPageProps {
  params: Promise<{ id: string; name: string }>;
}

export default function BoxDetailPage({ params }: BoxDetailPageProps) {
  const { id, name } = use(params);
  const bento = useBentoStore((s) => s.getBento(id));
  const agents = useAgentStore((s) => s.getAgentsForBento(id));
  const agent = agents.find((a) => a.name === name);

  if (!bento || !agent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Agent not found</h2>
          <p className="text-gray-600 mb-4">
            The agent you're looking for doesn't exist in this bento.
          </p>
          <Link
            href={`/bento/${id}`}
            className="text-amber-700 hover:text-amber-800 inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to agents
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/bento/${id}`}
          className="p-2 hover:bg-amber-500/50 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-800" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 uppercase">{agent.name}</h1>
          <p className="text-gray-700 text-sm">{agent.message}</p>
        </div>
      </div>

      {/* Bento Box Container - Dark frame like tablet screen */}
      <div className="bg-gray-900 rounded-[32px] p-4 shadow-2xl shadow-black/30">
        {/* Main 2-column layout matching reference */}
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Left Column - Neural Stream (Agent Chat) */}
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
    </div>
  );
}
