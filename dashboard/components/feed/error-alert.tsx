"use client"

import { AlertCircle } from "lucide-react"
import { CopyButton } from "@/components/shared/copy-button"

export interface TeamErrorAlertProps {
  agent: string
  text: string
  onClickAgent?: (name: string) => void
}

/**
 * Team error alert -- prominent error from an agent.
 * SOURCE: StreamEvent with isError flag, or TimelineEntry.summary with error content
 */
export function TeamErrorAlert({ agent, text, onClickAgent }: TeamErrorAlertProps) {
  return (
    <div className="group/msg relative flex gap-2.5 min-w-0">
      <button type="button" onClick={() => onClickAgent?.(agent)} className="shrink-0 cursor-pointer">
        <div className="w-6 h-6 rounded-full flex items-center justify-center bg-danger-subtle mt-1">
          <AlertCircle className="h-3.5 w-3.5 text-danger" />
        </div>
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-danger font-mono mb-0.5">{agent}</div>
        <div className="rounded-lg border border-danger/20 bg-danger-subtle/20 px-3 py-2">
          <p className="text-xs text-danger leading-relaxed font-mono whitespace-pre-wrap">
            {text}
          </p>
        </div>
      </div>
      {text.length > 0 && (
        <div className="absolute top-0 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          <CopyButton text={text} />
        </div>
      )}
    </div>
  )
}
