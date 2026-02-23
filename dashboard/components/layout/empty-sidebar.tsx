"use client"

import { ArrowUp } from "lucide-react"

export function EmptySidebar() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4">
      <ArrowUp className="h-3.5 w-3.5 text-muted" />
      <span className="text-muted text-xs text-center">No sessions yet</span>
    </div>
  )
}
