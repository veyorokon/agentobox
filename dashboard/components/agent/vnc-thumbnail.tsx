"use client"

import { cn } from "@/lib/utils"
import type { Agent } from "@/lib/types"

export interface VncThumbnailProps {
  agent: Agent
}

/** VNC thumbnail placeholder -- aspect ratio matches a 16:10 display */
export function VncThumbnail({ agent }: VncThumbnailProps) {
  const isRunning = agent.lifecycleStatus === "running"
  const isStopped = agent.lifecycleStatus === "stopped"

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden bg-surface-sunken/40 flex flex-col",
        isRunning ? "border-border-default" : "border-border-subtle",
        isStopped && "opacity-50",
      )}
    >
      {/* VNC viewport -- 16:10 aspect ratio */}
      <div className="relative w-full" style={{ aspectRatio: "16 / 10" }}>
        {/* Simulated desktop content */}
        <div className="absolute inset-0 flex flex-col">
          {/* Fake title bar */}
          <div className="h-4 bg-surface-sunken flex items-center px-2 gap-1 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-danger/60" />
            <span className="h-1.5 w-1.5 rounded-full bg-warning/60" />
            <span className="h-1.5 w-1.5 rounded-full bg-success/60" />
            <span className="ml-2 text-[7px] text-muted/40 font-mono truncate">
              {agent.name} — {isRunning ? agent.task : isStopped ? "session ended" : agent.lifecycleStatus}
            </span>
          </div>
          {/* Fake terminal content */}
          <div className="flex-1 bg-surface p-1.5 overflow-hidden">
            {isRunning ? (
              <div className="space-y-0.5">
                <p className="text-[6px] font-mono text-success/50 leading-tight">$ claude</p>
                <p className="text-[6px] font-mono text-muted/30 leading-tight truncate">{agent.lastOutput}</p>
                <p className="text-[6px] font-mono text-accent/40 leading-tight">
                  <span className="animate-pulse">&#9610;</span>
                </p>
              </div>
            ) : isStopped ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-[7px] font-mono text-muted/20">session ended</span>
              </div>
            ) : agent.lifecycleStatus === "error" ? (
              <div className="space-y-0.5">
                <p className="text-[6px] font-mono text-danger/50 leading-tight">Error: {agent.task}</p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <span className="text-[7px] font-mono text-muted/25">{agent.lifecycleStatus}</span>
              </div>
            )}
          </div>
        </div>

        {/* Live indicator overlay */}
        {isRunning && (
          <div className="absolute top-1 right-1 inline-flex items-center gap-1 rounded bg-black/50 px-1 py-px">
            <span className="h-1 w-1 rounded-full bg-success animate-breathe text-success" />
            <span className="text-[6px] text-success font-mono">live</span>
          </div>
        )}
      </div>
    </div>
  )
}
