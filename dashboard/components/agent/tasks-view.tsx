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
  const { tasks, loading } = useAgentTasks(agent.id, agent.taskProgress)
  const updateTask = useUpdateTask()
  const createTask = useCreateTask()
  const [filter, setFilter] = useState<Filter>("all")
  const [newTaskText, setNewTaskText] = useState("")
  const [newTaskDescription, setNewTaskDescription] = useState("")
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

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
    createTask(agent.id, text, newTaskDescription.trim())
    setNewTaskText("")
    setNewTaskDescription("")
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
            isExpanded={expandedTaskId === task.taskId}
            onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.taskId ? null : task.taskId)}
          />
        ))}
        {filteredTasks.length === 0 && !loading && (
          <div className="py-4 text-center">
            <p className="text-[10px] text-muted/50">
              {filter === "all" ? "No tasks yet" : `No ${filter} tasks`}
            </p>
          </div>
        )}
      </div>

      {/* Add task form */}
      <div className="px-2.5 py-1.5 border-t border-border-subtle shrink-0 space-y-1">
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
        <textarea
          value={newTaskDescription}
          onChange={(e) => setNewTaskDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              e.preventDefault()
              handleCreate()
            }
          }}
          placeholder="Description (optional)..."
          rows={2}
          className="w-full bg-surface-sunken/40 border border-border-subtle rounded px-2 py-1 text-[10px] text-default placeholder:text-muted/40 outline-none focus:border-accent/40 resize-none"
        />
      </div>
    </div>
  )
}

function TaskRow({
  task,
  agentName,
  onToggle,
  isExpanded,
  onToggleExpand,
}: {
  task: AgentTask
  agentName: string
  onToggle: () => void
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  const isBlocked = task.blockedBy.length > 0
  const isCompleted = task.status === "completed"
  const isInProgress = task.status === "in_progress"
  const hasDescription = task.description && task.description.trim().length > 0

  return (
    <div className={cn(
      "w-full transition-colors",
      isInProgress && "border-l-2 border-accent",
      isCompleted && "opacity-50",
    )}>
      <div
        className={cn(
          "w-full flex items-center gap-1.5 px-2.5 py-1 transition-colors",
          hasDescription && "cursor-pointer hover:bg-surface-raised/30",
          isBlocked && "opacity-40",
        )}
        onClick={hasDescription ? onToggleExpand : undefined}
        style={{ height: 22 }}
      >
        {/* Checkbox / lock */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (!isBlocked) onToggle()
          }}
          disabled={isBlocked}
          className="shrink-0"
        >
          {isBlocked ? (
            <Lock size={10} className="text-muted/30" />
          ) : isCompleted ? (
            <CheckSquare size={10} className="text-success/60 hover:text-success/80 transition-colors" />
          ) : (
            <Square size={10} className="text-muted/50 hover:text-muted/70 transition-colors" />
          )}
        </button>

        {/* Title */}
        <span
          className={cn(
            "text-[10px] font-mono truncate flex-1 min-w-0",
            isCompleted && "line-through text-muted",
            !isCompleted && "text-default",
          )}
        >
          {task.title}
        </span>

        {/* Assignee pill — only if different from this agent */}
        {task.assignee && task.assignee !== agentName && (
          <span className="text-[8px] px-1 rounded bg-surface-sunken/60 text-muted font-mono shrink-0">
            {task.assignee}
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
      </div>

      {/* Description — shown when expanded */}
      {isExpanded && hasDescription && (
        <div className="px-2.5 pb-1.5 pt-0">
          <p className="text-[9px] text-muted/70 leading-relaxed whitespace-pre-wrap">
            {task.description}
          </p>
        </div>
      )}
    </div>
  )
}
