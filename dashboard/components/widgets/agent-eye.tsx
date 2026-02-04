export function AgentEye() {
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
            <span className="text-gray-400 text-xs">agentobax.com</span>
          </div>
        </div>

        {/* Website Content */}
        <div className="p-4 bg-gray-900">
          {/* Nav */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="text-purple-400 font-bold text-sm">AgentoBax</div>
              <div className="flex gap-3 text-xs text-gray-400">
                <span>Home</span>
                <span>Features</span>
                <span>Solutions</span>
                <span>Pricing</span>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-400 text-xs">Log In</span>
              <span className="bg-purple-500 text-white text-xs px-2 py-0.5 rounded">My App</span>
            </div>
          </div>

          {/* Hero */}
          <div className="text-center py-4">
            <h3 className="text-white text-lg font-bold mb-1">
              Build the web <span className="text-green-400">bastop.</span>
            </h3>
            <p className="text-gray-500 text-xs mb-3 max-w-xs mx-auto">
              Start as a guild art prom started formations and other gravidade at an master armi finish even pro-plasm.
            </p>
            <div className="flex justify-center gap-2">
              <button className="bg-purple-500 text-white text-xs px-3 py-1 rounded">
                Open store free
              </button>
              <button className="bg-transparent border border-gray-600 text-white text-xs px-3 py-1 rounded">
                Demo video has →
              </button>
            </div>

            {/* Color Swatches */}
            <div className="flex justify-center gap-2 mt-4">
              <div className="w-8 h-8 rounded bg-green-500" />
              <div className="w-8 h-8 rounded bg-blue-500" />
              <div className="w-8 h-8 rounded bg-orange-500" />
              <div className="w-8 h-8 rounded bg-red-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Input Field */}
      <div className="mt-4 bg-gray-800 rounded-xl p-3">
        <p className="text-white text-sm mb-2">What are your conents?</p>
        <p className="text-gray-500 text-xs">
          Service symbol make of story campoware writediskers a hurui-fox tecnic representating plus alto and hole-allow camera and redo it.
        </p>
      </div>
    </div>
  )
}
