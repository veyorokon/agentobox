"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Collapsible } from "@/components/ui/collapsible"

export interface ToolRowProps {
  toolName: string
  summary: string
}

export interface SingleToolRowProps {
  toolName: string
  summary: string
}

export interface MultiToolGroupProps {
  tools: { name: string; summary: string }[]
}

/** Single tool call row, collapsible */
export function SingleToolRow({
  toolName,
  summary,
}: SingleToolRowProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="ml-8">
      <div className="border-l-2 rounded-r border-l-muted/40">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-2 w-full text-left px-2.5 py-1 cursor-pointer hover:bg-surface-sunken/40 transition-colors"
        >
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 text-muted transition-transform duration-(--duration-normal)",
              expanded && "rotate-90",
            )}
          />
          <span className="text-xs font-medium shrink-0 text-info">
            {toolName}
          </span>
          <span className="text-xs text-muted font-mono truncate min-w-0">
            {summary}
          </span>
        </button>
        <Collapsible open={expanded}>
          <div className="px-3 py-2 ml-4">
            <div className="rounded bg-surface-sunken/60 p-2">
              <p className="font-mono text-xs text-muted whitespace-pre-wrap">
                {summary}
              </p>
            </div>
          </div>
        </Collapsible>
      </div>
    </div>
  )
}

/** Individual tool row inside a multi-tool group */
export function ToolRow({ toolName, summary }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 w-full text-left px-2.5 py-0.5 cursor-pointer hover:bg-surface-sunken/40 transition-colors"
      >
        <ChevronRight
          size={10}
          className={cn(
            "shrink-0 text-muted transition-transform duration-(--duration-normal)",
            expanded && "rotate-90",
          )}
        />
        <span className="text-[11px] font-medium shrink-0 text-info">
          {toolName}
        </span>
        <span className="text-[11px] text-muted font-mono truncate min-w-0">
          {summary}
        </span>
      </button>
      <Collapsible open={expanded}>
        <div className="px-3 py-1.5 ml-4">
          <div className="rounded bg-surface-sunken/60 p-2">
            <p className="font-mono text-[11px] text-muted whitespace-pre-wrap">
              {summary}
            </p>
          </div>
        </div>
      </Collapsible>
    </div>
  )
}

/** Multi-tool group -- collapsible group header */
export function MultiToolGroup({
  tools,
}: MultiToolGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const uniqueNames = tools
    .map((t) => t.name)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ")

  return (
    <div className="ml-8">
      <div className="border-l-2 rounded-r border-l-muted/40">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-2 w-full text-left px-2.5 py-1 cursor-pointer hover:bg-surface-sunken/40 transition-colors"
        >
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 text-muted transition-transform duration-(--duration-normal)",
              expanded && "rotate-90",
            )}
          />
          <span className="text-xs text-secondary">
            {tools.length} tool uses
          </span>
          <span className="text-[11px] text-muted font-mono truncate min-w-0">
            {uniqueNames}
          </span>
        </button>
        <Collapsible open={expanded}>
          <div className="ml-2 space-y-px">
            {tools.map((tool, i) => (
              <ToolRow key={i} toolName={tool.name} summary={tool.summary} />
            ))}
          </div>
        </Collapsible>
      </div>
    </div>
  )
}
