'use client';

import { useState } from 'react';
import { useAgentStore } from '@/stores';
import { Pause, Square, Play } from 'lucide-react';

interface BoxControlsProps {
  bentoId: string;
  agentName: string;
  status: string;
}

export function BoxControls({ bentoId, agentName, status }: BoxControlsProps) {
  const [isPaused, setIsPaused] = useState(status === 'idle');
  const killAgent = useAgentStore((s) => s.killAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);

  const handlePauseToggle = () => {
    const newPaused = !isPaused;
    setIsPaused(newPaused);
    updateAgent(bentoId, agentName, {
      status: newPaused ? 'idle' : 'working',
      message: newPaused ? 'Agent paused' : 'Agent resumed',
    });
  };

  const handleKill = () => {
    if (confirm(`Are you sure you want to kill agent "${agentName}"?`)) {
      killAgent(bentoId, agentName);
    }
  };

  return (
    <div className="bg-amber-50 rounded-3xl p-5 h-full min-h-[160px]">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">CONTROLS</h2>
      </div>

      {/* Control Buttons */}
      <div className="flex justify-center gap-4 mb-3">
        {/* Pause/Resume Button */}
        <button
          onClick={handlePauseToggle}
          className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 ${
            isPaused
              ? 'bg-emerald-500 hover:bg-emerald-600'
              : 'bg-yellow-400 hover:bg-yellow-500'
          }`}
          style={{
            boxShadow: '0 6px 0 rgba(0,0,0,0.2), 0 8px 10px rgba(0,0,0,0.15)',
          }}
        >
          {isPaused ? (
            <Play className="w-7 h-7 text-white" />
          ) : (
            <Pause className="w-7 h-7 text-gray-800" />
          )}
        </button>

        {/* Kill Button */}
        <button
          onClick={handleKill}
          className="w-16 h-16 rounded-2xl bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
          style={{
            boxShadow: '0 6px 0 rgba(0,0,0,0.2), 0 8px 10px rgba(0,0,0,0.15)',
          }}
        >
          <Square className="w-7 h-7 text-white" />
        </button>
      </div>

      {/* Labels */}
      <div className="flex justify-center gap-4">
        <span className="text-xs font-semibold text-gray-700 w-16 text-center">
          {isPaused ? 'RESUME' : 'PAUSE'}
        </span>
        <span className="text-xs font-semibold text-gray-700 w-16 text-center">KILL</span>
      </div>
    </div>
  );
}
