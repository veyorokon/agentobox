"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Collapsible } from "@/components/ui/collapsible"
import { ChevronRight } from "lucide-react"
import { ToolCallItem } from "@/components/feed/tool-call-item"
import type { FeedItem, ToolUseItem } from "@/types"

type ToolGroupProps = {
  item: FeedItem
}

function getToolSummary(tool: ToolUseItem): string {
  const input = tool.input
  switch (tool.name) {
    case "Read":
      return `Read ${String(input.file_path ?? input.path ?? "file")}`
    case "Write":
      return `Wrote ${String(input.file_path ?? input.path ?? "file")}`
    case "Edit":
      return `Edited ${String(input.file_path ?? input.path ?? "file")}`
    case "Bash":
      return String(input.description ?? input.command ?? "")
    case "Grep":
      return `Searched for ${String(input.pattern ?? "pattern")}`
    case "Glob":
      return `Found files matching ${String(input.pattern ?? "pattern")}`
    case "WebFetch":
      return `Fetched ${String(input.url ?? "URL")}`
    case "Task":
    case "TaskCreate":
    case "TaskUpdate":
      return String(input.subject ?? input.description ?? input.prompt ?? "task")
    default:
      return tool.name
  }
}

function getGroupLabel(tools: ToolUseItem[]): string {
  if (tools.length === 0) return ""
  if (tools.length === 1) {
    const summary = getToolSummary(tools[0])
    return summary.length > 80 ? summary.slice(0, 77) + "..." : summary
  }
  // multiple tools — use first tool's summary
  const firstSummary = getToolSummary(tools[0])
  const truncated =
    firstSummary.length > 60 ? firstSummary.slice(0, 57) + "..." : firstSummary
  return `${truncated} (+${tools.length - 1} more)`
}

export function ToolGroup({ item }: ToolGroupProps) {
  const [open, setOpen] = useState(false)
  const tools = item.tools ?? []
  const hasError = tools.some((t) => t.isError)
  const label = getGroupLabel(tools)

  if (tools.length === 0) return null

  return (
    <div className="max-w-[calc(100%-2rem)]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-1 py-0.5 text-xs text-text-300 cursor-pointer hover:text-text-100 transition-colors"
      >
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="text-left line-clamp-1">{label}</span>
        {hasError && (
          <span className="h-1.5 w-1.5 rounded-full bg-danger-000 shrink-0" />
        )}
      </button>

      <Collapsible open={open}>
        <div className="space-y-0.5 mt-1 ml-1">
          {tools.map((tool, i) => (
            <ToolCallItem key={i} tool={tool} />
          ))}
        </div>
      </Collapsible>
    </div>
  )
}
