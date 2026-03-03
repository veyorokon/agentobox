"use client"

import { useState, useRef, useEffect } from "react"
import { ChevronRight, Check, X } from "lucide-react"
import { cn, stripSystemReminders } from "@/lib/utils"
import { Collapsible } from "@/components/ui/collapsible"

/* ── Types ──────────────────────────────────────────────────────────── */

export interface ToolRowProps {
  toolName: string
  summary: string
  result?: string
  isError?: boolean
}

export interface SingleToolRowProps {
  toolName: string
  summary: string
  result?: string
  isError?: boolean
}

export interface MultiToolGroupProps {
  tools: { name: string; summary: string; result?: string; isError?: boolean }[]
}

/* ── Constants ──────────────────────────────────────────────────────── */

/** Max height (px) before "Show more" kicks in */
const CLAMP_HEIGHT = 128

/** Tools whose results render as terminal output (dark bg, monospace) */
const TERMINAL_TOOLS = new Set(["Bash", "bash"])

/* ── Result content block ───────────────────────────────────────────── */

function ToolResultContent({
  result,
  toolName,
  isError,
  fontSize = "text-xs",
}: {
  result: string
  toolName: string
  isError?: boolean
  fontSize?: string
}) {
  const [clamped, setClamped] = useState(true)
  const [needsClamp, setNeedsClamp] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (el) setNeedsClamp(el.scrollHeight > CLAMP_HEIGHT)
  }, [result])

  const cleaned = stripSystemReminders(result)
  const isTerminal = TERMINAL_TOOLS.has(toolName)

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={cn(
          "rounded-b border-t border-border-default/8 overflow-hidden transition-[max-height] duration-(--duration-slow) ease-out",
          isTerminal
            ? "bg-surface-sunken"
            : "bg-surface-sunken/80",
          clamped && needsClamp && "max-h-32",
        )}
      >
        <pre
          className={cn(
            "p-2.5 font-mono whitespace-pre-wrap break-words overflow-x-hidden",
            fontSize,
            isError
              ? "text-danger/80"
              : isTerminal
                ? "text-secondary/90"
                : "text-muted",
          )}
        >
          {cleaned}
        </pre>
      </div>

      {/* Gradient fade overlay */}
      {needsClamp && clamped && (
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 h-12 pointer-events-none rounded-b",
            isTerminal
              ? "bg-gradient-to-t from-surface-sunken to-transparent"
              : "bg-gradient-to-t from-surface-sunken/80 to-transparent",
          )}
        />
      )}

      {/* Show more / Show less toggle */}
      {needsClamp && (
        <button
          type="button"
          onClick={() => setClamped(!clamped)}
          className="pt-1.5 pb-0.5 text-xs text-info/80 hover:text-info transition-colors"
        >
          {clamped ? "Show more" : "Show less"}
        </button>
      )}
    </div>
  )
}

/* ── Status dot ─────────────────────────────────────────────────────── */

function StatusDot({ isError, hasResult }: { isError?: boolean; hasResult: boolean }) {
  if (!hasResult) return null
  if (isError) return <X size={10} className="shrink-0 text-danger/60" />
  return <Check size={10} className="shrink-0 text-success/50" />
}

/* ── Single tool row ────────────────────────────────────────────────── */

/** Single tool call row, collapsible — shows result output when expanded */
export function SingleToolRow({
  toolName,
  summary,
  result,
  isError,
}: SingleToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const hasResult = Boolean(result?.trim())

  return (
    <div className="ml-8">
      <div className={cn(
        "border-l-2 rounded-r",
        isError ? "border-l-danger/40" : "border-l-muted/40",
      )}>
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
          <span className={cn(
            "text-xs font-medium shrink-0",
            isError ? "text-danger/80" : "text-info",
          )}>
            {toolName}
          </span>
          <span className="text-xs text-muted font-mono truncate min-w-0">
            {summary}
          </span>
          <StatusDot isError={isError} hasResult={hasResult} />
        </button>
        <Collapsible open={expanded}>
          <div className="ml-4 mr-1 mb-1">
            {hasResult ? (
              <ToolResultContent
                result={result!}
                toolName={toolName}
                isError={isError}
              />
            ) : (
              <div className="rounded bg-surface-sunken/60 p-2">
                <p className="font-mono text-xs text-muted/60 italic">
                  No output
                </p>
              </div>
            )}
          </div>
        </Collapsible>
      </div>
    </div>
  )
}

/* ── Tool row (inside multi-group) ──────────────────────────────────── */

/** Individual tool row inside a multi-tool group */
export function ToolRow({ toolName, summary, result, isError }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const hasResult = Boolean(result?.trim())

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
        <span className={cn(
          "text-[11px] font-medium shrink-0",
          isError ? "text-danger/80" : "text-info",
        )}>
          {toolName}
        </span>
        <span className="text-[11px] text-muted font-mono truncate min-w-0">
          {summary}
        </span>
        <StatusDot isError={isError} hasResult={hasResult} />
      </button>
      <Collapsible open={expanded}>
        <div className="ml-4 mr-1 mb-0.5">
          {hasResult ? (
            <ToolResultContent
              result={result!}
              toolName={toolName}
              isError={isError}
              fontSize="text-[11px]"
            />
          ) : (
            <div className="rounded bg-surface-sunken/60 p-2">
              <p className="font-mono text-[11px] text-muted/60 italic">
                No output
              </p>
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  )
}

/* ── Multi-tool group ───────────────────────────────────────────────── */

/** Multi-tool group -- collapsible group header */
export function MultiToolGroup({
  tools,
}: MultiToolGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const hasErrors = tools.some(t => t.isError)
  const uniqueNames = tools
    .map((t) => t.name)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ")

  return (
    <div className="ml-8">
      <div className={cn(
        "border-l-2 rounded-r",
        hasErrors ? "border-l-danger/40" : "border-l-muted/40",
      )}>
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
              <ToolRow
                key={i}
                toolName={tool.name}
                summary={tool.summary}
                result={tool.result}
                isError={tool.isError}
              />
            ))}
          </div>
        </Collapsible>
      </div>
    </div>
  )
}
