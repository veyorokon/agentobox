'use client';

import { Terminal as TerminalIcon } from 'lucide-react';

interface BoxTerminalProps {
  agentName: string;
}

export function BoxTerminal({ agentName }: BoxTerminalProps) {
  // Mock terminal output
  const lines = [
    { time: '10:32:15', text: `[${agentName}] Starting task...` },
    { time: '10:32:16', text: '> Analyzing requirements' },
    { time: '10:32:18', text: '> Fetching dependencies' },
    { time: '10:32:20', text: '> Processing data...' },
    { time: '10:32:25', text: '> Task in progress' },
    { time: '10:32:30', text: '█' },
  ];

  return (
    <div className="bg-gray-900 rounded-3xl p-5 h-full min-h-[240px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-white">TERMINAL</h2>
          <TerminalIcon className="w-5 h-5 text-gray-500" />
        </div>
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
        </div>
      </div>

      {/* Terminal Content */}
      <div className="flex-1 bg-gray-950 rounded-xl p-4 font-mono text-sm overflow-auto">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-3 mb-1">
            <span className="text-gray-600 text-xs">{line.time}</span>
            <span className={`${line.text === '█' ? 'animate-pulse text-green-400' : 'text-gray-300'}`}>
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
