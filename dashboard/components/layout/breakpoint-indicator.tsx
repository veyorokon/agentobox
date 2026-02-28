"use client"

import type { Breakpoint } from "@/lib/types"

export function BreakpointIndicator({ bp }: { bp: Breakpoint }) {
  const labels: Record<Breakpoint, { text: string; width: string }> = {
    XL: { text: "XL", width: "\u22651920" },
    L: { text: "L", width: "1440-1919" },
    M: { text: "M", width: "1280-1439" },
    S: { text: "S", width: "1024-1279" },
    mobile: { text: "Mobile", width: "<1024" },
  }

  const info = labels[bp]

  return (
    <div className="fixed bottom-4 right-4 z-(--z-toast) inline-flex items-center gap-1.5 rounded-full bg-surface-overlay border border-border-default shadow-lg px-3 py-1.5">
      <span className="h-2 w-2 rounded-full bg-accent" />
      <span className="text-[11px] font-semibold text-default">{info.text}</span>
      <span className="text-[10px] text-muted font-mono">{info.width}px</span>
    </div>
  )
}
