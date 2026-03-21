"use client"

import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

export function BackendStatusBanner({
  title,
  detail,
  className,
  onRetry,
}: {
  title: string
  detail: string
  className?: string
  onRetry?: () => void
}) {
  return (
    <div className={cn("border-b border-danger/20 bg-danger/6", className)}>
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3 text-[11px]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger/75" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-danger/85">{title}</p>
          <p className="mt-0.5 text-danger/70">{detail}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded border border-danger/20 bg-danger/10 px-2 py-1 text-[10px] font-medium text-danger/80 transition-colors hover:bg-danger/15"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
