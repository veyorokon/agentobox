"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  MoreVertical,
  RotateCcw,
  Trash2,
  Power,
  Zap,
  ClipboardList,
  ShieldOff,
  Code,
  Eraser,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types"

type AgentActionsProps = {
  agent: Agent
  onKill: (agentId: string) => void
  onRemove: (agentId: string) => void
  onRestart: (agentId: string) => void
  onSetMode: (agentId: string, mode: string) => void
  onClearSession: (agentId: string) => void
}

const MODE_CYCLE = [
  { value: "default", label: "Normal", icon: Code },
  { value: "plan", label: "Plan", icon: ClipboardList },
  { value: "bypassPermissions", label: "YOLO", icon: ShieldOff },
] as const

function getNextMode(current: string): (typeof MODE_CYCLE)[number] {
  const normalized = (current || "default").toLowerCase()
  const idx = MODE_CYCLE.findIndex(
    (m) => normalized === m.value.toLowerCase(),
  )
  const nextIdx = (idx + 1) % MODE_CYCLE.length
  return MODE_CYCLE[nextIdx]
}

function getCurrentMode(agent: Agent): (typeof MODE_CYCLE)[number] {
  const mode = (agent.permissionMode || "default").toLowerCase()
  return (
    MODE_CYCLE.find(
      (m) => mode === m.value.toLowerCase(),
    ) ?? MODE_CYCLE[0]
  )
}

function AgentActions({
  agent,
  onKill,
  onRemove,
  onRestart,
  onSetMode,
  onClearSession,
}: AgentActionsProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open, handleClickOutside])

  const isActive = agent.status === "running" || agent.status === "idle"
  const nextMode = getNextMode(agent.permissionMode)
  const currentMode = getCurrentMode(agent)

  const handleAction = useCallback(
    (action: () => void) => {
      action()
      setOpen(false)
    },
    [],
  )

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="p-1 rounded text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors cursor-pointer"
        title="Agent actions"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={cn(
            "absolute top-full right-0 mt-1.5 z-(--z-dropdown)",
            "bg-surface-raised border border-border-default rounded-lg shadow-lg p-1.5 min-w-[180px]",
            "animate-in fade-in duration-(--duration-normal)",
          )}
        >
          {/* Mode toggle — disabled when agent is not running/idle */}
          <button
            type="button"
            disabled={!isActive}
            onClick={() =>
              handleAction(() => onSetMode(agent.id, nextMode.value))
            }
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors",
              isActive
                ? "text-secondary hover:text-default hover:bg-surface-sunken"
                : "text-muted cursor-not-allowed opacity-50",
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">
              Mode: {currentMode.label}
            </span>
            {isActive && (
              <span className="text-[10px] text-muted">
                &rarr; {nextMode.label}
              </span>
            )}
          </button>

          {/* Restart */}
          <button
            type="button"
            onClick={() => handleAction(() => onRestart(agent.id))}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-secondary hover:text-default hover:bg-surface-sunken rounded transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restart
          </button>

          {/* Clear session */}
          <button
            type="button"
            onClick={() => handleAction(() => onClearSession(agent.id))}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-secondary hover:text-default hover:bg-surface-sunken rounded transition-colors"
          >
            <Eraser className="h-3.5 w-3.5" />
            Clear session
          </button>

          <div className="my-1 h-px bg-border-default" />

          {/* Kill */}
          <button
            type="button"
            onClick={() => handleAction(() => onKill(agent.id))}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-danger hover:bg-surface-sunken rounded transition-colors"
          >
            <Power className="h-3.5 w-3.5" />
            Kill agent
          </button>

          {/* Remove */}
          <button
            type="button"
            onClick={() => handleAction(() => onRemove(agent.id))}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-danger hover:bg-surface-sunken rounded transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove agent
          </button>
        </div>
      )}
    </div>
  )
}

export { AgentActions }
export type { AgentActionsProps }
