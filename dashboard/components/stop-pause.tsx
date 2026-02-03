"use client"

import { useState } from "react"

export function StopPause() {
  const [isActive, setIsActive] = useState(false)

  return (
    <div className="bg-amber-50 rounded-3xl p-5 h-full min-h-[160px]">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">STOP/PAUSE</h2>
      </div>

      {/* Toggle Switch */}
      <div className="flex justify-center mb-3">
        <button
          onClick={() => setIsActive(!isActive)}
          className="relative w-24 h-16 rounded-2xl bg-yellow-400 shadow-lg transition-all duration-300 hover:shadow-xl active:scale-95"
          style={{
            boxShadow: isActive 
              ? 'inset 0 4px 8px rgba(0,0,0,0.2)' 
              : '0 6px 0 #ca8a04, 0 8px 10px rgba(0,0,0,0.2)'
          }}
        >
          <div 
            className={`absolute inset-2 rounded-xl bg-yellow-300 transition-transform duration-150 ${isActive ? 'translate-y-1' : ''}`}
            style={{
              boxShadow: isActive ? 'none' : 'inset 0 -2px 4px rgba(0,0,0,0.1)'
            }}
          />
        </button>
      </div>

      {/* Label */}
      <p className="text-center text-sm font-semibold text-gray-800">TACTILE SWITCH</p>
    </div>
  )
}
