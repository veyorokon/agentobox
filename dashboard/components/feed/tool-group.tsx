"use client"

import { useState, useContext } from "react"
import { cn, friendlyToolName } from "@/lib/utils"
import { Collapsible } from "@/components/ui/collapsible"
import { ChevronRight } from "lucide-react"
import { FeedScrollContext } from "@/components/feed/feed-container"
import { ToolCallItem } from "@/components/feed/tool-call-item"
import type { ToolUseBlock } from "@/types"

type ToolGroupProps = {
  toolBlocks: ToolUseBlock[]
}

function getToolSummary(tool: ToolUseBlock): string {
  const input = tool.input
  switch (tool.name) {
    case "Read":
      return String(input.file_path ?? input.path ?? "file")
    case "Write":
      return String(input.file_path ?? input.path ?? "file")
    case "Edit":
      return String(input.file_path ?? input.path ?? "file")
    case "Bash":
      return String(input.description ?? input.command ?? "")
    case "Grep":
      return `pattern: ${String(input.pattern ?? "")}`
    case "Glob":
      return String(input.pattern ?? "")
    case "WebFetch":
      return String(input.url ?? "URL")
    case "Task":
    case "TaskCreate":
    case "TaskUpdate":
      return String(input.subject ?? input.description ?? input.prompt ?? "task")
    case "TodoWrite":
      return "Update Todos"
    case "SendMessage":
    case "mcp__abox-coord__teammate_message":
      return `→ ${String(input.recipient ?? input.agentId ?? "")}`
    case "mcp__abox-coord__teammate_broadcast":
      return "broadcast"
    case "mcp__abox-coord__task_list":
      return "list tasks"
    case "mcp__abox-coord__team_status":
      return "team status"
    case "mcp__abox-coord__task_add":
      return String(input.title ?? "add task")
    case "mcp__abox-coord__task_claim":
    case "mcp__abox-coord__task_complete":
      return String(input.task_id ?? input.title ?? "")
    default:
      return ""
  }
}

/** Collapse threshold -- show first + last and "Show N more" for middle */
const COLLAPSE_THRESHOLD = 3

export function ToolGroup({ toolBlocks }: ToolGroupProps) {
  if (toolBlocks.length === 0) return null

  // Single tool -- render inline without the group wrapper
  if (toolBlocks.length === 1) {
    return <div className="ml-8"><SingleToolRow tool={toolBlocks[0]} /></div>
  }

  // Multiple tools -- collapsible group
  return <div className="ml-8"><MultiToolGroup tools={toolBlocks} /></div>
}

function SingleToolRow({ tool }: { tool: ToolUseBlock }) {
  const [expanded, setExpanded] = useState(false)
  const { scrollToBottom } = useContext(FeedScrollContext)
  const summary = getToolSummary(tool)

  return (
    <div className="border-l-2 rounded-r border-l-text-500/40">
      <button
        type="button"
        onClick={() => {
          const willExpand = !expanded
          setExpanded(willExpand)
          if (willExpand) requestAnimationFrame(() => scrollToBottom())
        }}
        className="flex items-center gap-2 w-full text-left px-2.5 py-1 cursor-pointer hover:bg-bg-200/40 transition-colors"
      >
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 text-text-500 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <span className="text-xs font-medium shrink-0 text-accent-secondary-000">
          {friendlyToolName(tool.name)}
        </span>
        {summary && (
          <span className="text-xs text-text-400 font-mono truncate min-w-0">
            {summary}
          </span>
        )}
      </button>

      <Collapsible open={expanded}>
        <ToolCallItem tool={tool} expandedByDefault />
      </Collapsible>
    </div>
  )
}

function MultiToolGroup({ tools }: { tools: ToolUseBlock[] }) {
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const { scrollToBottom } = useContext(FeedScrollContext)
  const needsCollapse = tools.length > COLLAPSE_THRESHOLD

  // When collapsed and many tools, show first and last
  const visibleTools = !showAll && needsCollapse
    ? [tools[0], tools[tools.length - 1]]
    : tools
  const hiddenCount = tools.length - 2

  return (
    <div className="border-l-2 rounded-r border-l-text-500/40">
      {/* Group header */}
      <button
        type="button"
        onClick={() => {
          const willExpand = !expanded
          setExpanded(willExpand)
          if (willExpand) requestAnimationFrame(() => scrollToBottom())
        }}
        className="flex items-center gap-2 w-full text-left px-2.5 py-1 cursor-pointer hover:bg-bg-200/40 transition-colors"
      >
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 text-text-500 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <span className="text-xs text-text-300">
          {tools.length} tool uses
        </span>
        <span className="text-[11px] text-text-500 font-mono truncate min-w-0">
          {tools.map((t) => friendlyToolName(t.name)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
        </span>
      </button>

      {/* Expanded tool list */}
      <Collapsible open={expanded}>
        <div className="ml-2 space-y-px">
          {needsCollapse && !showAll ? (
            <>
              <ToolRow tool={visibleTools[0]} />
              <button
                type="button"
                onClick={() => {
                  setShowAll(true)
                  requestAnimationFrame(() => scrollToBottom())
                }}
                className="text-[11px] text-accent-secondary-100 hover:text-accent-secondary-000 px-2.5 py-1 cursor-pointer font-mono"
              >
                Show {hiddenCount} more
              </button>
              <ToolRow tool={visibleTools[1]} />
            </>
          ) : (
            tools.map((tool, i) => <ToolRow key={i} tool={tool} />)
          )}
        </div>
      </Collapsible>
    </div>
  )
}

function ToolRow({ tool }: { tool: ToolUseBlock }) {
  const [expanded, setExpanded] = useState(false)
  const { scrollToBottom } = useContext(FeedScrollContext)
  const summary = getToolSummary(tool)

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const willExpand = !expanded
          setExpanded(willExpand)
          if (willExpand) requestAnimationFrame(() => scrollToBottom())
        }}
        className="flex items-center gap-2 w-full text-left px-2.5 py-0.5 cursor-pointer hover:bg-bg-200/40 transition-colors"
      >
        <ChevronRight
          size={10}
          className={cn(
            "shrink-0 text-text-500 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <span className="text-[11px] font-medium shrink-0 text-accent-secondary-000">
          {friendlyToolName(tool.name)}
        </span>
        {summary && (
          <span className="text-[11px] text-text-400 font-mono truncate min-w-0">
            {summary}
          </span>
        )}
      </button>

      <Collapsible open={expanded}>
        <ToolCallItem tool={tool} expandedByDefault />
      </Collapsible>
    </div>
  )
}
