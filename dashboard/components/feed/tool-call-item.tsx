"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { CollapsibleOutput } from "@/components/shared/collapsible-output"
import { FileLink } from "@/components/shared/file-link"
import type { ToolUseItem } from "@/types"

type ToolCallItemProps = {
  tool: ToolUseItem
}

function getInputSummary(tool: ToolUseItem): string {
  const input = tool.input
  switch (tool.name) {
    case "Read":
      return String(input.file_path ?? input.path ?? "")
    case "Write":
      return String(input.file_path ?? input.path ?? "")
    case "Edit":
      return String(input.file_path ?? input.path ?? "")
    case "Bash":
      return String(input.command ?? "")
    case "Grep":
      return String(input.pattern ?? "")
    case "Glob":
      return String(input.pattern ?? "")
    case "WebFetch":
      return String(input.url ?? "")
    case "Task":
    case "TaskCreate":
    case "TaskUpdate":
      return String(input.subject ?? input.description ?? input.prompt ?? "")
    default:
      return Object.keys(input).slice(0, 3).join(", ")
  }
}

function getResultText(tool: ToolUseItem): string {
  const result = tool.result
  if (!result) return ""
  if (typeof result === "string") return result
  if ("output" in result) return String(result.output)
  if ("content" in result) return String(result.content)
  if ("text" in result) return String(result.text)
  return JSON.stringify(result, null, 2)
}

export function ToolCallItem({ tool }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false)
  const summary = getInputSummary(tool)
  const resultText = getResultText(tool)
  const isFileTool = ["Read", "Write", "Edit"].includes(tool.name)
  const filePath = isFileTool ? summary : null

  return (
    <div className="rounded-md overflow-hidden">
      {/* Header row: tool name label + input summary */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-start gap-2 w-full text-left px-2 py-1.5 cursor-pointer hover:bg-bg-200/50 transition-colors"
      >
        <span
          className={cn(
            "text-[11px] font-semibold shrink-0 mt-px",
            tool.isError
              ? "text-danger-000"
              : "text-accent-secondary-000",
          )}
        >
          {tool.name}
        </span>

        <span className="text-xs text-text-300 font-mono truncate min-w-0">
          {filePath ? (
            <FileLink path={filePath} className="text-xs" />
          ) : (
            summary
          )}
        </span>

        {tool.isError && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-danger-900/30 text-danger-000 shrink-0">
            Error
          </span>
        )}
      </button>

      {/* Expanded: show result output */}
      {expanded && resultText && (
        <div
          className={cn(
            "mx-2 mb-2 px-3 py-2 rounded bg-bg-300",
            tool.isError && "text-danger-000",
          )}
        >
          <CollapsibleOutput content={resultText} maxHeight={120} />
        </div>
      )}
    </div>
  )
}
