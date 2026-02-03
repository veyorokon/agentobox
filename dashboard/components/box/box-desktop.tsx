'use client';

interface BoxDesktopProps {
  agentName: string;
}

export function BoxDesktop({ agentName }: BoxDesktopProps) {
  return (
    <div className="bg-gray-900 rounded-3xl p-5 h-full min-h-[320px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">AGENT'S EYE</h2>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white text-sm font-medium">LIVE</span>
        </div>
      </div>

      {/* Browser Preview */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {/* Browser Chrome */}
        <div className="bg-gray-700 px-3 py-2 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <div className="flex-1 bg-gray-600 rounded px-3 py-1 mx-2">
            <span className="text-gray-400 text-xs">{agentName}.desktop</span>
          </div>
        </div>

        {/* VNC Placeholder */}
        <div className="aspect-video bg-gray-900 flex items-center justify-center relative">
          <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 opacity-50" />
          <div className="text-center z-10">
            <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gray-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-500 text-sm">VNC stream will appear here</p>
            <p className="text-gray-600 text-xs mt-1">Agent is working...</p>
          </div>

          {/* Scan lines effect */}
          <div
            className="absolute inset-0 pointer-events-none opacity-10"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.03) 1px, rgba(255,255,255,0.03) 2px)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
