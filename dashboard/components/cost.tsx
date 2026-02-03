export function Cost() {
  return (
    <div className="bg-yellow-400 rounded-3xl p-5 h-full min-h-[160px]">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">COST</h2>
      </div>

      {/* Digital Display */}
      <div className="bg-amber-700/80 rounded-xl p-4 mb-3">
        <div className="flex items-center justify-center gap-1">
          {/* Hour digits */}
          <div className="flex gap-0.5">
            <DigitDisplay value="0" />
            <DigitDisplay value="1" />
          </div>
          
          {/* Colon */}
          <div className="flex flex-col gap-1 mx-1">
            <div className="w-2 h-2 rounded-full bg-amber-300/80" />
            <div className="w-2 h-2 rounded-full bg-amber-300/80" />
          </div>
          
          {/* Minute digits */}
          <div className="flex gap-0.5">
            <DigitDisplay value="0" />
            <DigitDisplay value="0" />
          </div>
        </div>
      </div>

      {/* Label */}
      <p className="text-center text-sm font-semibold text-gray-800">DIGITAL RECEIPT</p>
    </div>
  )
}

function DigitDisplay({ value }: { value: string }) {
  return (
    <div className="w-8 h-12 bg-amber-900/50 rounded border-2 border-amber-600/50 flex items-center justify-center">
      <span className="text-amber-200 text-2xl font-mono font-bold" style={{ textShadow: '0 0 10px rgba(251, 191, 36, 0.5)' }}>
        {value}
      </span>
    </div>
  )
}
