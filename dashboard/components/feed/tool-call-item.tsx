"use client"

import { cn } from "@/lib/utils"
import { CollapsibleOutput } from "@/components/shared/collapsible-output"
import type { ToolUseBlock } from "@/types"

type ToolCallItemProps = {
  tool: ToolUseBlock
  expandedByDefault?: boolean
}

function getInputDisplay(tool: ToolUseBlock): string {
  const input = tool.input
  if (!input || Object.keys(input).length === 0) return ""

  switch (tool.name) {
    case "Bash":
      return String(input.command ?? "")
    case "Read":
    case "Write":
    case "Edit":
      return String(input.file_path ?? input.path ?? "")
    case "Grep":
      return `pattern: ${String(input.pattern ?? "")}`
    case "Glob":
      return `pattern: ${String(input.pattern ?? "")}`
    case "WebFetch":
      return String(input.url ?? "")
    case "Task":
      return String(input.description ?? input.prompt ?? "")
    case "SendMessage":
    case "mcp__abox-coord__teammate_message":
    case "mcp__abox-coord__teammate_broadcast": {
      const content = input.content ?? input.message ?? ""
      const recipient = input.recipient ?? input.agentId ?? ""
      const msg = typeof content === "string"
        ? content
        : JSON.stringify(content, null, 2)
      return recipient ? `→ ${recipient}: ${msg}` : msg
    }
    case "mcp__abox-coord__task_add":
    case "mcp__abox-coord__task_claim":
    case "mcp__abox-coord__task_complete":
      return String(input.title ?? input.task_id ?? input.description ?? "")
    case "TaskCreate":
    case "TaskUpdate":
      return String(input.subject ?? input.description ?? "")
    default: {
      // For unknown tools, show a compact key=value format instead of raw JSON
      const pairs = Object.entries(input)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => {
          const val = typeof v === "string" ? v : JSON.stringify(v)
          const short = val.length > 80 ? val.slice(0, 80) + "…" : val
          return `${k}: ${short}`
        })
      return pairs.join("\n")
    }
  }
}

export function ToolCallItem({ tool, expandedByDefault }: ToolCallItemProps) {
  const inputDisplay = getInputDisplay(tool)
  const result = tool._result

  if (!inputDisplay && !result) return null

  return (
    <div className="mx-2.5 mb-1.5 rounded bg-surface-sunken/60 overflow-hidden">
      {inputDisplay && (
        <div className="px-3 py-1.5">
          <CollapsibleOutput
            content={inputDisplay}
            maxHeight={100}
            className="text-[11px]"
          />
        </div>
      )}
      {result && result.content && (
        <div
          className={cn(
            "px-3 py-1.5",
            inputDisplay && "border-t border-border-default/10",
            result.isError && "bg-danger-subtle/20",
          )}
        >
          {result.isError && (
            <span className="text-[9px] font-mono font-medium text-danger/70 uppercase tracking-wider">
              error
            </span>
          )}
          <CollapsibleOutput
            content={result.content}
            maxHeight={80}
            className={cn(
              "text-[11px]",
              result.isError ? "text-danger/80" : "text-muted",
            )}
          />
        </div>
      )}
    </div>
  )
}
