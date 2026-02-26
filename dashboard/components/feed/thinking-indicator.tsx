"use client"

export interface ThinkingIndicatorProps {
  label?: string
}

/** Pulsing dots indicator (used in agent detail feed only) */
export function ThinkingIndicator({ label = "Thinking..." }: ThinkingIndicatorProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted text-[11px] font-mono">
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
      </span>
      <span>{label}</span>
    </span>
  )
}
