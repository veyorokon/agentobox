"use client"

import { useRef, useState, useCallback, type KeyboardEvent } from "react"
import { ArrowUp, Square, Plus, Code, ClipboardList, ShieldOff } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types"

type ComposerProps = {
  onSend: (message: string, agentId?: string) => void
  onInterrupt?: () => void
  disabled?: boolean
  isStreaming?: boolean
  agents?: Agent[]
  selectedAgentId?: string | null
  sessionCostUsd?: number | null
}

function Composer({
  onSend,
  onInterrupt,
  disabled = false,
  isStreaming = false,
  agents = [],
  selectedAgentId,
  sessionCostUsd,
}: ComposerProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null

  const placeholder = selectedAgent
    ? `Message ${selectedAgent.name}...`
    : "Message all agents..."

  const hasContent = value.trim().length > 0

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
    // Reset height after clearing
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = "auto"
      }
    })
  }, [value, disabled, onSend, selectedAgentId])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleSubmitClick = useCallback(() => {
    if (isStreaming && onInterrupt) {
      onInterrupt()
    } else {
      handleSend()
    }
  }, [isStreaming, onInterrupt, handleSend])

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
    <div className="px-4 pb-4 pt-2">
      <div
        className={cn(
          "rounded-2xl border-[0.5px] border-border-300 bg-bg-000/60 transition-colors",
          "focus-within:bg-bg-000 focus-within:border-border-300",
        )}
      >
        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
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

            {/* Mode indicator */}
            {modeInfo && (
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium",
                modeInfo.className,
              )}>
                <modeInfo.icon className="h-3 w-3" />
                {modeInfo.label}
              </span>
            )}

            {/* Target agent pill */}
            {selectedAgent && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-200 text-xs text-text-300 font-medium">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    selectedAgent.status === "working"
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

            {/* Submit / interrupt button */}
            <button
              type="button"
              onClick={handleSubmitClick}
              disabled={!submitActive}
              className={cn(
                "flex items-center justify-center h-8 w-8 rounded-full transition-all",
                submitActive
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
