"use client"

import { AlertCircle, RotateCcw } from "lucide-react"

export interface ErrorBubbleProps {
  agent: string
  text: string
  showAgent?: boolean
}

/** Danger-styled error message with restart action */
export function ErrorBubble({ agent, text, showAgent = true }: ErrorBubbleProps) {
  return (
    <div className="flex gap-2 min-w-0">
      <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-danger-subtle mt-1">
        <AlertCircle className="h-3.5 w-3.5 text-danger" />
      </div>
      <div className="min-w-0 flex-1">
        {showAgent && <div className="text-[11px] text-danger font-mono mb-0.5">{agent}</div>}
        <div className="rounded-r bg-danger-subtle/40 border-l-2 border-l-danger px-3 py-2">
          <p className="text-xs text-danger leading-relaxed font-mono whitespace-pre-wrap">
            {text}
          </p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-danger/30 text-[11px] text-danger font-medium hover:bg-danger-subtle/60 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Restart
          </button>
        </div>
      </div>
    </div>
  )
}
