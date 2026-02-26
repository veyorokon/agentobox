"use client"

import { Check, CheckSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { ChatAvatar } from "@/components/agent/avatar"

export interface TodoListProps {
  agent: string
  tasks: { text: string; done: boolean }[]
}

/** Compact checklist for agent task tracking */
export function TodoList({
  agent,
  tasks,
}: TodoListProps) {
  return (
    <div className="group/msg flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
        <div className="rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-md">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckSquare className="h-3.5 w-3.5 text-info" />
            <span className="text-xs font-medium text-secondary">Tasks</span>
            <span className="text-[10px] text-muted font-mono ml-auto">
              {tasks.filter((t) => t.done).length}/{tasks.length}
            </span>
          </div>
          <div className="space-y-1">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-start gap-2">
                <div
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                    task.done
                      ? "bg-success/20 border-success/40"
                      : "border-border-default",
                  )}
                >
                  {task.done && (
                    <Check className="h-2.5 w-2.5 text-success" strokeWidth={3} />
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs leading-tight",
                    task.done
                      ? "text-muted line-through"
                      : "text-secondary",
                  )}
                >
                  {task.text}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border-subtle">
            <span className="text-[10px] text-muted/50 font-mono">
              + Add task...
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
