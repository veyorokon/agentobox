"use client"

type ThinkingIndicatorProps = {
  /** Text to display, e.g. "Working..." or "backend running" */
  label?: string
}

export function ThinkingIndicator({
  label = "Working...",
}: ThinkingIndicatorProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-accent-main-000 text-xs font-mono">
      <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
        <span className="animate-pulse-dot" style={{ animationDelay: "0ms" }}>
          ✦
        </span>
        <span
          className="animate-pulse-dot"
          style={{ animationDelay: "150ms" }}
        >
          ✦
        </span>
        <span
          className="animate-pulse-dot"
          style={{ animationDelay: "300ms" }}
        >
          ✦
        </span>
      </span>
      <span>{label}</span>
    </span>
  )
}
