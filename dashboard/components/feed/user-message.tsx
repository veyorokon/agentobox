"use client"

export interface TeamUserMessageProps {
  text: string
  target?: string
}

/**
 * Team user message -- right-aligned with optional @target indicator.
 * SOURCE: user input via composer (with optional @agent targeting)
 */
export function TeamUserMessage({ text, target }: TeamUserMessageProps) {
  return (
    <div className="flex justify-end py-1">
      <div className="max-w-[80%]">
        {target && (
          <div className="flex justify-end mb-0.5">
            <span className="text-[10px] text-accent font-mono">@{target}</span>
          </div>
        )}
        <div className="bg-accent/15 border border-accent/20 rounded px-3 py-1.5">
          <p className="text-default text-sm whitespace-pre-wrap leading-relaxed">
            {text}
          </p>
        </div>
      </div>
    </div>
  )
}
