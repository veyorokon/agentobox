"use client"

import { useRef, useState, useCallback, useEffect, type KeyboardEvent } from "react"
import { ArrowUp, Square, Plus, Code, ClipboardList, ShieldOff } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types"

const MODE_CYCLE = [
  { value: "default", label: "Normal", icon: Code },
  { value: "plan", label: "Plan", icon: ClipboardList },
  { value: "bypassPermissions", label: "YOLO", icon: ShieldOff },
] as const

type ComposerProps = {
  onSend: (message: string, agentId?: string) => void
  onInterrupt?: () => void
  onSetAgentMode?: (agentId: string, mode: string) => void
  onSelectAgent?: (agentId: string | null) => void
  disabled?: boolean
  isStreaming?: boolean
  agents?: Agent[]
  selectedAgentId?: string | null
  sessionCostUsd?: number | null
}

function Composer({
  onSend,
  onInterrupt,
  onSetAgentMode,
  onSelectAgent,
  disabled = false,
  isStreaming = false,
  agents = [],
  selectedAgentId,
  sessionCostUsd,
}: ComposerProps) {
  const [value, setValue] = useState("")
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mentionRef = useRef<HTMLDivElement>(null)

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null

  const placeholder = selectedAgent
    ? `Message ${selectedAgent.name}...`
    : "Message all agents... (type @ to target)"

  const hasContent = value.trim().length > 0

  // Filter agents for @mention autocomplete
  const mentionMatches = mentionQuery !== null
    ? agents.filter((a) => a.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : []

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed, selectedAgentId ?? undefined)
    setValue("")
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = "auto"
      }
    })
  }, [value, disabled, onSend, selectedAgentId])

  // Insert a @mention: select the agent and clear the @query from input
  const insertMention = useCallback((agent: Agent) => {
    // Remove the @query from the input value
    const atIdx = value.lastIndexOf("@")
    const before = atIdx >= 0 ? value.slice(0, atIdx) : value
    setValue(before)
    setMentionQuery(null)
    setMentionIndex(0)
    // Select the agent as target
    onSelectAgent?.(agent.id)
    textareaRef.current?.focus()
  }, [value, onSelectAgent])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // @mention navigation
      if (mentionQuery !== null && mentionMatches.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setMentionIndex((i) => (i + 1) % mentionMatches.length)
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length)
          return
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault()
          insertMention(mentionMatches[mentionIndex])
          return
        }
      }

      // Dismiss @mention on Escape
      if (e.key === "Escape" && mentionQuery !== null) {
        e.preventDefault()
        setMentionQuery(null)
        return
      }

      // Escape interrupts running agent (when no @mention open and input is empty)
      if (e.key === "Escape" && isStreaming && onInterrupt && !hasContent) {
        e.preventDefault()
        onInterrupt()
        return
      }

      // Enter sends
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend, mentionQuery, mentionMatches, mentionIndex, insertMention, isStreaming, onInterrupt, hasContent],
  )

  // Track @mention query from input value
  const handleChange = useCallback((newValue: string) => {
    setValue(newValue)

    // Check for @mention trigger: find last @ that isn't preceded by a non-space char
    const atIdx = newValue.lastIndexOf("@")
    if (atIdx >= 0 && (atIdx === 0 || newValue[atIdx - 1] === " " || newValue[atIdx - 1] === "\n")) {
      const query = newValue.slice(atIdx + 1)
      // Only show menu if query has no spaces (still typing the name)
      if (!query.includes(" ") && !query.includes("\n")) {
        setMentionQuery(query)
        setMentionIndex(0)
        return
      }
    }
    setMentionQuery(null)
  }, [])

  const handleSubmitClick = useCallback(() => {
    if (isStreaming && onInterrupt) {
      onInterrupt()
    } else {
      handleSend()
    }
  }, [isStreaming, onInterrupt, handleSend])

  // Close @mention dropdown on click outside
  useEffect(() => {
    if (mentionQuery === null) return
    const handler = (e: MouseEvent) => {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        setMentionQuery(null)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [mentionQuery])

  // Format cost as $X.XX
  const formattedCost =
    sessionCostUsd != null && sessionCostUsd > 0
      ? `$${sessionCostUsd.toFixed(2)}`
      : null

  // Derive mode label + icon from selected agent's permissionMode
  const modeInfo = (() => {
    if (!selectedAgent) return null
    const mode = selectedAgent.permissionMode?.toLowerCase() ?? "default"
    if (mode === "plan") {
      return {
        label: "Plan mode",
        icon: ClipboardList,
        className: "text-accent-pro-000",
      }
    }
    if (mode.includes("skip") || mode.includes("bypass")) {
      return {
        label: "YOLO mode",
        icon: ShieldOff,
        className: "text-warning-000",
      }
    }
    return {
      label: "Normal",
      icon: Code,
      className: "text-text-400",
    }
  })()

  // Submit button is active when there is content to send or streaming to interrupt
  const submitActive = isStreaming || (hasContent && !disabled)

  return (
    <div className="px-6 pb-4 pt-2 max-w-3xl mx-auto w-full">
      <div
        className={cn(
          "relative rounded-2xl border-[0.5px] border-border-300 bg-bg-000/60 transition-colors",
          "focus-within:bg-bg-000 focus-within:border-border-300",
        )}
      >
        {/* @mention autocomplete dropdown */}
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <div
            ref={mentionRef}
            className={cn(
              "absolute bottom-full left-3 mb-1.5 z-50",
              "bg-bg-000 border border-border-300 rounded-lg shadow-lg p-1 min-w-[180px] max-h-[200px] overflow-y-auto",
            )}
          >
            {mentionMatches.map((agent, i) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => insertMention(agent)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded transition-colors",
                  i === mentionIndex
                    ? "bg-bg-200 text-text-100"
                    : "text-text-300 hover:bg-bg-200/50 hover:text-text-100",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    agent.status === "running"
                      ? "bg-success-000"
                      : agent.status === "idle"
                        ? "bg-accent-secondary-000"
                        : "bg-text-500",
                  )}
                />
                <span className="truncate">{agent.name}</span>
                <span className="text-[10px] text-text-500 ml-auto">{agent.status}</span>
              </button>
            ))}
          </div>
        )}

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            handleChange(e.target.value)
            resize()
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            "w-full bg-transparent border-none outline-none resize-none",
            "px-4 pt-4 pb-2 text-sm text-text-100 placeholder:text-text-500",
            "min-h-[52px] max-h-[40vh]",
          )}
        />

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-3 pb-3">
          {/* Left side: attachment button + agent pill */}
          <div className="flex items-center gap-2">
            {/* Attachment button (placeholder, disabled) */}
            <button
              type="button"
              disabled
              className="rounded-lg p-1.5 text-text-500 cursor-not-allowed opacity-50 hover:bg-bg-200 transition-colors"
              title="Attach files (coming soon)"
            >
              <Plus className="h-4 w-4" />
            </button>

            {/* Mode indicator — clickable to cycle modes when a single agent is selected */}
            {modeInfo && selectedAgent && onSetAgentMode ? (
              <button
                type="button"
                onClick={() => {
                  const currentMode = selectedAgent.permissionMode?.toLowerCase() ?? "default"
                  const idx = MODE_CYCLE.findIndex(
                    (m) => currentMode === m.value || currentMode.includes(m.value),
                  )
                  const nextIdx = (idx + 1) % MODE_CYCLE.length
                  onSetAgentMode(selectedAgent.id, MODE_CYCLE[nextIdx].value)
                }}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer",
                  "hover:bg-bg-200 transition-colors",
                  modeInfo.className,
                )}
                title={`Click to change mode`}
              >
                <modeInfo.icon className="h-3 w-3" />
                {modeInfo.label}
              </button>
            ) : modeInfo ? (
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium",
                modeInfo.className,
              )}>
                <modeInfo.icon className="h-3 w-3" />
                {modeInfo.label}
              </span>
            ) : null}

            {/* Target agent pill */}
            {selectedAgent && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-200 text-xs text-text-300 font-medium">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    selectedAgent.status === "running"
                      ? "bg-success-000"
                      : selectedAgent.status === "idle"
                        ? "bg-accent-secondary-000"
                        : "bg-text-500",
                  )}
                />
                {selectedAgent.name}
              </span>
            )}
          </div>

          {/* Right side: cost indicator + submit button */}
          <div className="flex items-center gap-3">
            {/* Session cost */}
            {formattedCost && (
              <span className="text-xs text-text-500 tabular-nums">
                {formattedCost}
              </span>
            )}

            {/* Escape hint when streaming */}
            {isStreaming && !hasContent && (
              <span className="text-[10px] text-text-500">
                esc to stop
              </span>
            )}

            {/* Submit / interrupt button */}
            <button
              type="button"
              onClick={handleSubmitClick}
              disabled={!submitActive}
              className={cn(
                "flex items-center justify-center h-8 w-8 rounded-full transition-all",
                isStreaming
                  ? "bg-danger-000 text-oncolor-100 hover:bg-danger-100 shadow-sm"
                  : submitActive
                    ? "bg-accent-main-000 text-oncolor-100 hover:bg-accent-main-100 shadow-sm"
                    : "bg-bg-200 text-text-500 cursor-not-allowed",
              )}
            >
              {isStreaming ? (
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { Composer }
export type { ComposerProps }
