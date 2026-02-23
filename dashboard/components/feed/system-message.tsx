import { ThinkingIndicator } from "@/components/feed/thinking-indicator"
import { friendlyModelName } from "@/lib/utils"
import type { SystemEventData } from "@/types"

type SystemMessageProps = {
  data: SystemEventData
}

export function SystemMessage({ data }: SystemMessageProps) {
  const subtype = data.subtype

  switch (subtype) {
    case "init": {
      const rawModel = data.model
      const model = rawModel ? friendlyModelName(rawModel) : undefined
      const tools = data.tools
      const toolCount = tools?.length ?? 0

      return (
        <div className="flex items-center justify-center py-px">
          <span className="text-muted/60 text-[10px] font-mono">
            {model && <span>{model}</span>}
            {model && toolCount > 0 && <span className="mx-1">&middot;</span>}
            {toolCount > 0 && <span>{toolCount} tools</span>}
            {!model && toolCount === 0 && "session initialized"}
          </span>
        </div>
      )
    }

    case "process_exit": {
      const exitCode = data.exit_code
      const isError = exitCode !== undefined && exitCode !== 0

      return (
        <div className="flex items-center justify-center py-px">
          <span className={`text-[10px] font-mono ${isError ? "text-danger/80" : "text-muted/60"}`}>
            process exited{exitCode !== undefined ? ` (code ${exitCode})` : ""}
          </span>
        </div>
      )
    }

    case "status": {
      const text = data.text
      if (!text) return null

      const lower = text.toLowerCase()
      const isActive = ["restarting", "starting", "switching", "running"].some(
        (kw) => lower.includes(kw),
      )

      if (isActive) {
        return (
          <div className="flex items-center justify-center py-px">
            <ThinkingIndicator label={text} />
          </div>
        )
      }

      return (
        <div className="flex items-center justify-center py-px">
          <span className="text-muted/60 text-[10px] font-mono">{text}</span>
        </div>
      )
    }

    default: {
      const text = data.text ?? data.message ?? null
      if (!text) return null

      return (
        <div className="flex items-center justify-center py-px">
          <span className="text-muted/60 text-[10px] font-mono">{text}</span>
        </div>
      )
    }
  }
}
