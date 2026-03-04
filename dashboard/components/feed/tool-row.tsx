"use client"

import { useState, useRef, useEffect } from "react"
import { ChevronDown } from "lucide-react"
import { cn, stripSystemReminders, summarizeSingleTool, summarizeToolGroup } from "@/lib/utils"
import { Collapsible } from "@/components/ui/collapsible"

/* ── Types ──────────────────────────────────────────────────────────── */

export interface ToolEntryData {
  name: string
  summary: string
  filePath?: string
  lineDelta?: { added: number; removed: number } | null
  result?: string
  isError?: boolean
  /** For Edit tools: the old string being replaced */
  oldString?: string
  /** For Edit tools: the new string replacing it */
  newString?: string
}

/* ── Constants ──────────────────────────────────────────────────────── */

const CLAMP_HEIGHT = 128
const OVERFLOW_LIMIT = 3

/* ── Unified diff view ──────────────────────────────────────────────── */

interface DiffLine {
  type: "context" | "added" | "removed"
  oldNum?: number
  newNum?: number
  text: string
}

/** Compute a unified diff from old/new strings with N lines of context. */
function computeUnifiedDiff(oldStr: string, newStr: string, contextLines = 3): DiffLine[] {
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")

  // Simple LCS-based diff
  const m = oldLines.length
  const n = newLines.length
  // Build edit script using DP (O(mn) but inputs are small — tool edits)
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack to get raw operations
  const ops: Array<{ type: "equal" | "removed" | "added"; old?: string; new?: string; oldIdx?: number; newIdx?: number }> = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: "equal", old: oldLines[i - 1], oldIdx: i, newIdx: j })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "added", new: newLines[j - 1], newIdx: j })
      j--
    } else {
      ops.unshift({ type: "removed", old: oldLines[i - 1], oldIdx: i })
      i--
    }
  }

  // Find changed regions and include context
  const changeIndices = new Set<number>()
  ops.forEach((op, idx) => {
    if (op.type !== "equal") {
      for (let c = Math.max(0, idx - contextLines); c <= Math.min(ops.length - 1, idx + contextLines); c++) {
        changeIndices.add(c)
      }
    }
  })

  const lines: DiffLine[] = []
  let oldNum = 0, newNum = 0
  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx]
    if (op.type === "equal") {
      oldNum++; newNum++
      if (changeIndices.has(idx)) {
        lines.push({ type: "context", oldNum, newNum, text: op.old! })
      } else if (lines.length > 0 && lines[lines.length - 1]?.type !== undefined) {
        // Gap marker — skip (we just omit lines not in context)
      }
    } else if (op.type === "removed") {
      oldNum++
      if (changeIndices.has(idx)) {
        lines.push({ type: "removed", oldNum, text: op.old! })
      }
    } else {
      newNum++
      if (changeIndices.has(idx)) {
        lines.push({ type: "added", newNum, text: op.new! })
      }
    }
  }

  return lines
}

function UnifiedDiffView({ oldString, newString }: { oldString: string; newString: string }) {
  const lines = computeUnifiedDiff(oldString, newString)

  return (
    <div className="mt-1 rounded border border-border-default/20 overflow-hidden font-mono text-[11px] leading-[18px]">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "flex",
            line.type === "removed" && "bg-danger/10",
            line.type === "added" && "bg-success/10",
          )}
        >
          {/* Old line number */}
          <span className="w-8 shrink-0 text-right pr-1 select-none text-muted/40 border-r border-border-default/10">
            {line.type !== "added" ? line.oldNum : ""}
          </span>
          {/* New line number */}
          <span className="w-8 shrink-0 text-right pr-1 select-none text-muted/40 border-r border-border-default/10">
            {line.type !== "removed" ? line.newNum : ""}
          </span>
          {/* +/- indicator */}
          <span className={cn(
            "w-4 shrink-0 text-center select-none",
            line.type === "removed" && "text-danger",
            line.type === "added" && "text-success",
          )}>
            {line.type === "removed" ? "-" : line.type === "added" ? "+" : ""}
          </span>
          {/* Line content */}
          <span className={cn(
            "flex-1 whitespace-pre-wrap break-all px-1",
            line.type === "removed" && "text-danger/80",
            line.type === "added" && "text-success/80",
            line.type === "context" && "text-muted",
          )}>
            {line.text}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ── Result content ────────────────────────────────────────────────── */

function ToolResultContent({
  result,
  isError,
}: {
  result: string
  isError?: boolean
}) {
  const [clamped, setClamped] = useState(true)
  const [needsClamp, setNeedsClamp] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (el) setNeedsClamp(el.scrollHeight > CLAMP_HEIGHT)
  }, [result])

  const cleaned = stripSystemReminders(result)

  return (
    <div className="group/result">
      <div
        ref={contentRef}
        className={cn(
          "overflow-hidden transition-[max-height] duration-(--duration-slow) ease-out",
          clamped && needsClamp && "max-h-32",
        )}
        style={
          needsClamp
            ? { maskImage: clamped ? "linear-gradient(black 70%, transparent)" : undefined }
            : undefined
        }
      >
        <div
          className={cn(
            "font-mono text-[11px] font-light whitespace-pre-wrap break-all pt-1",
            isError ? "text-danger/80" : "text-muted",
          )}
        >
          {cleaned.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {"\n"}
            </span>
          ))}
        </div>
      </div>

      {needsClamp && (
        <button
          type="button"
          onClick={() => setClamped(!clamped)}
          className="text-xs text-muted hover:text-secondary transition-colors cursor-pointer opacity-0 group-hover/result:opacity-100 transition-opacity"
        >
          {clamped ? "Show more" : "Show less"}
        </button>
      )}
    </div>
  )
}

/* ── Tool entry row (inside expanded tree) ─────────────────────────── */

function ToolEntryRow({
  tool,
  isLast,
}: {
  tool: ToolEntryData
  isLast: boolean
}) {
  const [subExpanded, setSubExpanded] = useState(false)
  const hasResult = Boolean(tool.result?.trim())
  const hasDiff = Boolean(tool.oldString !== undefined || tool.newString !== undefined)
  const canExpand = hasResult || hasDiff

  return (
    <div className="relative flex flex-col">
      {/* Tree connectors */}
      <div
        className="absolute left-0 top-0 w-px bg-border-default/40"
        style={{ bottom: isLast ? "calc(100% - 13px)" : 0 }}
      />

      <div
        className={cn(
          "flex items-center gap-1.5 py-0.5",
          canExpand && "cursor-pointer",
        )}
        onClick={canExpand ? () => setSubExpanded(!subExpanded) : undefined}
      >
        {/* Horizontal arm */}
        <div className="w-1.5 h-px bg-border-default/40 shrink-0 -ml-0" />

        {/* Tool name label */}
        <span className="text-[13px] text-muted shrink-0">{tool.name}</span>

        {/* File path pill */}
        {tool.filePath && (
          <span className="font-mono text-[11px] bg-surface px-1 py-0.5 rounded truncate min-w-0 text-muted">
            {tool.filePath}
          </span>
        )}

        {/* Command/summary as pill when no file path */}
        {!tool.filePath && tool.summary && (
          <span className="font-mono text-[11px] bg-surface px-1 py-0.5 rounded truncate min-w-0 text-muted">
            {tool.summary}
          </span>
        )}

        {/* Line delta badges */}
        {tool.lineDelta && tool.lineDelta.added > 0 && (
          <span className="font-mono text-[11px] font-light text-success shrink-0">
            +{tool.lineDelta.added}
          </span>
        )}
        {tool.lineDelta && tool.lineDelta.removed > 0 && (
          <span className="font-mono text-[11px] font-light text-danger shrink-0">
            -{tool.lineDelta.removed}
          </span>
        )}
      </div>

      {/* Sub-expanded content: diff view or plain result */}
      {canExpand && (
        <Collapsible open={subExpanded}>
          <div className="ml-3.5">
            {hasDiff ? (
              <UnifiedDiffView
                oldString={tool.oldString ?? ""}
                newString={tool.newString ?? ""}
              />
            ) : (
              <ToolResultContent result={tool.result!} isError={tool.isError} />
            )}
          </div>
        </Collapsible>
      )}
    </div>
  )
}

/* ── Single tool row ────────────────────────────────────────────────── */

export function SingleToolRow({ tool }: { tool: ToolEntryData }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 w-full text-left py-0.5 cursor-pointer group"
      >
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-muted transition-transform duration-(--duration-normal)",
            !expanded && "-rotate-90",
          )}
        />
        <span className="text-[13px] text-muted group-hover:text-secondary transition-colors">
          {summarizeSingleTool(tool.name)}
        </span>
      </button>
      <Collapsible open={expanded}>
        <div className="pl-3 ml-1.5">
          <ToolEntryRow tool={tool} isLast={true} />
        </div>
      </Collapsible>
    </div>
  )
}

/* ── Multi-tool group ───────────────────────────────────────────────── */

export function MultiToolGroup({ tools }: { tools: ToolEntryData[] }) {
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const overflowCount = tools.length - OVERFLOW_LIMIT
  const visibleTools = showAll ? tools : tools.slice(0, OVERFLOW_LIMIT)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 w-full text-left py-0.5 cursor-pointer group"
      >
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-muted transition-transform duration-(--duration-normal)",
            !expanded && "-rotate-90",
          )}
        />
        <span className="text-[13px] text-muted group-hover:text-secondary transition-colors">
          {summarizeToolGroup(tools)}
        </span>
      </button>
      <Collapsible open={expanded}>
        <div className="pl-3 ml-1.5">
          {visibleTools.map((tool, i) => (
            <ToolEntryRow
              key={i}
              tool={tool}
              isLast={!showAll && i === visibleTools.length - 1 && overflowCount <= 0}
            />
          ))}
          {overflowCount > 0 && !showAll && (
            <div className="relative">
              <div className="absolute left-0 top-0 w-px bg-border-default/40 h-[9px]" />
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="ml-3 text-[11px] text-muted hover:text-secondary transition-colors cursor-pointer py-0.5"
              >
                Show {overflowCount} more
              </button>
            </div>
          )}
          {showAll && overflowCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="ml-3 text-[11px] text-muted hover:text-secondary transition-colors cursor-pointer py-0.5"
            >
              Show less
            </button>
          )}
        </div>
      </Collapsible>
    </div>
  )
}
