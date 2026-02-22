"use client"

type ThinkingIndicatorProps = {
  /** Text to display, e.g. "Working..." or "backend running" */
  label?: string
}

export function ThinkingIndicator({
  label = "Thinking...",
}: ThinkingIndicatorProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-400 text-[11px] font-mono">
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent-main-000" style={{ animationDelay: "0ms" }} />
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent-main-000" style={{ animationDelay: "150ms" }} />
        <span className="animate-pulse-dot h-1 w-1 rounded-full bg-accent-main-000" style={{ animationDelay: "300ms" }} />
      </span>
      <span>{label}</span>
    </span>
  )
}
