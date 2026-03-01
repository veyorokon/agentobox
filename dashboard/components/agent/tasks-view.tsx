"use client"

import { useState, useMemo } from "react"
import { Lock, CheckSquare, Square, Circle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAgentTasks, useUpdateTask, useCreateTask } from "@/lib/graphql/hooks/use-tasks"
import type { Agent, AgentTask } from "@/lib/types"

type Filter = "all" | "active" | "done"

export interface AgentTasksViewProps {
  agent: Agent
}

export function AgentTasksView({ agent }: AgentTasksViewProps) {
  const { tasks, loading } = useAgentTasks(agent.id, agent.todoProgress)
  const updateTask = useUpdateTask()
  const createTask = useCreateTask()
  const [filter, setFilter] = useState<Filter>("all")
  const [newTaskText, setNewTaskText] = useState("")

  const filteredTasks = useMemo(() => {
    switch (filter) {
      case "active":
        return tasks.filter((t) => t.status === "pending" || t.status === "in_progress")
      case "done":
        return tasks.filter((t) => t.status === "completed")
      default:
        return tasks
    }
  }, [tasks, filter])

  const doneCount = useMemo(() => tasks.filter((t) => t.status === "completed").length, [tasks])

  const handleToggle = (task: AgentTask) => {
    if (task.blockedBy.length > 0) return
    const next = task.status === "completed" ? "pending" : "completed"
    updateTask(agent.id, task.taskId, next)
  }

  const handleCreate = () => {
    const text = newTaskText.trim()
    if (!text) return
    createTask(agent.id, text)
    setNewTaskText("")
  }

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "done", label: "Done" },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border-subtle shrink-0">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
              filter === id
                ? "bg-surface-raised text-default"
                : "text-muted/50 hover:text-secondary hover:bg-surface-raised/40",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-muted font-mono tabular-nums">
          {doneCount}/{tasks.length} done
        </span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && tasks.length === 0 && (
          <div className="px-2.5 py-3 space-y-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[22px] rounded bg-surface-sunken/40 animate-pulse" />
            ))}
          </div>
        )}
        {filteredTasks.map((task) => (
          <TaskRow
            key={task.taskId}
            task={task}
            agentName={agent.name}
            onToggle={() => handleToggle(task)}
          />
        ))}
        {filteredTasks.length === 0 && !loading && (
          <div className="py-6 text-center">
            <CheckSquare className="h-4 w-4 text-muted/20 mx-auto mb-1" />
            <p className="text-[10px] text-muted/50">
              {filter === "all" ? "No tasks yet" : `No ${filter} tasks`}
            </p>
          </div>
        )}
      </div>

      {/* Add input */}
      <div className="px-2.5 py-1 border-t border-border-subtle shrink-0">
        <input
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleCreate()
            }
          }}
          placeholder="+ Add task..."
          className="w-full bg-transparent border-none outline-none text-[10px] text-default placeholder:text-muted/30 font-mono py-0.5"
        />
      </div>
    </div>
  )
}

function TaskRow({
  task,
  agentName,
  onToggle,
}: {
  task: AgentTask
  agentName: string
  onToggle: () => void
}) {
  const isBlocked = task.blockedBy.length > 0
  const isCompleted = task.status === "completed"
  const isInProgress = task.status === "in_progress"

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isBlocked}
      className={cn(
        "w-full flex items-center gap-1.5 px-2.5 py-1 text-left transition-colors hover:bg-surface-raised/30",
        isInProgress && "border-l-2 border-accent",
        isCompleted && "opacity-50",
        isBlocked && "opacity-40 cursor-not-allowed",
      )}
      style={{ height: 22 }}
    >
      {/* Checkbox / lock */}
      {isBlocked ? (
        <Lock size={10} className="text-muted/30 shrink-0" />
      ) : isCompleted ? (
        <CheckSquare size={10} className="text-success/60 shrink-0" />
      ) : (
        <Square size={10} className="text-muted/50 shrink-0" />
      )}

      {/* Subject */}
      <span
        className={cn(
          "text-[10px] font-mono truncate flex-1 min-w-0",
          isCompleted && "line-through text-muted",
          !isCompleted && "text-default",
        )}
      >
        {task.subject}
      </span>

      {/* Owner pill — only if different from this agent */}
      {task.owner && task.owner !== agentName && (
        <span className="text-[8px] px-1 rounded bg-surface-sunken/60 text-muted font-mono shrink-0">
          {task.owner}
        </span>
      )}

      {/* Status dot */}
      <Circle
        size={5}
        className={cn(
          "shrink-0 fill-current",
          isInProgress && "text-accent animate-breathe",
          task.status === "pending" && "text-muted/30",
          isCompleted && "text-success/40",
        )}
      />
    </button>
  )
}
