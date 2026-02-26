"use client"

export interface SystemMessageProps {
  text: string
}

/** Centered tiny text for session lifecycle events */
export function SystemMessage({ text }: SystemMessageProps) {
  return (
    <div className="flex items-center justify-center py-px">
      <span className="text-muted/60 text-[10px] font-mono">{text}</span>
    </div>
  )
}
