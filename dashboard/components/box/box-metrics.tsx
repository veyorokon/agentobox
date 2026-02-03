'use client';

import { Activity } from 'lucide-react';

interface BoxMetricsProps {
  cpu?: number;
  ram?: number;
}

export function BoxMetrics({ cpu = 62, ram = 30 }: BoxMetricsProps) {
  return (
    <div className="bg-cyan-400 rounded-3xl p-5 h-full min-h-[200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">HEARTBEAT</h2>
        <Activity className="w-6 h-6 text-gray-900" />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4">
        {/* CPU */}
        <div>
          <div className="bg-cyan-500/50 rounded-xl p-3 mb-2 h-20 relative overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
              <defs>
                <linearGradient id="cpuGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </linearGradient>
              </defs>
              <path
                d="M0,40 Q10,35 20,38 T40,30 T60,35 T80,25 T100,30"
                fill="none"
                stroke="white"
                strokeWidth="2"
              />
              <path
                d="M0,40 Q10,35 20,38 T40,30 T60,35 T80,25 T100,30 L100,50 L0,50 Z"
                fill="url(#cpuGradient)"
              />
            </svg>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">CPU</span>
            <span className="text-sm font-bold text-gray-900">{cpu}%</span>
          </div>
        </div>

        {/* RAM */}
        <div>
          <div className="bg-cyan-500/50 rounded-xl p-3 mb-2 h-20 relative overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
              <defs>
                <linearGradient id="ramGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </linearGradient>
              </defs>
              <path
                d="M0,35 Q15,40 25,32 T50,38 T75,30 T100,35"
                fill="none"
                stroke="white"
                strokeWidth="2"
              />
              <path
                d="M0,35 Q15,40 25,32 T50,38 T75,30 T100,35 L100,50 L0,50 Z"
                fill="url(#ramGradient)"
              />
            </svg>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">RAM</span>
            <span className="text-sm font-bold text-gray-900">{ram}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
