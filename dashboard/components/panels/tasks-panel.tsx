"use client"

import { useState, useMemo, useCallback } from "react"
import {
  Search,
  ChevronRight,
  CheckSquare,
  Square,
  Lock,
  Circle,
  Pause,
  Play,
  Check,
  Inbox,
  CheckCircle,
  RotateCcw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useAgents } from "@/lib/graphql/hooks/use-agents"
import { useUpdateTask } from "@/lib/graphql/hooks/use-tasks"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible } from "@/components/ui/collapsible"
import { AgentAvatar } from "@/components/agent/avatar"
import type { AgentTask } from "@/lib/types"

type Filter = "all" | "active" | "unassigned" | "pending" | "in_progress" | "completed"

interface TaskWithAgent extends AgentTask {
  agentId: string
  agentName: string
}

export function TasksPanel() {
  // Store state
  const search = useSidebarStore(s => s.taskSearch || "")
  const setSearch = useSidebarStore(s => s.setTaskSearch || (() => {}))

  // Data hooks
  const { data: agentsData } = useAgents()
  const agents = agentsData?.agents ?? []
  const updateTask = useUpdateTask()

  // Ephemeral state
  const [filter, setFilter] = useState<Filter>("active")
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["unassigned"]))
  const [selectMode, setSelectMode] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())

  // Select mode handlers
  const toggleTaskSelect = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedTaskIds(new Set())
  }, [])

  // Aggregate all tasks across agents
  const allTasks = useMemo<TaskWithAgent[]>(() => {
    const tasks: TaskWithAgent[] = []
    for (const agent of agents) {
      for (const task of agent.tasks || []) {
        tasks.push({
          ...task,
          agentId: agent.id,
          agentName: agent.name,
        })
      }
    }
    return tasks
  }, [agents])

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let result = allTasks

    // Apply filter
    switch (filter) {
      case "active":
        result = result.filter(t => t.status === "pending" || t.status === "in_progress")
        break
      case "unassigned":
        result = result.filter(t => !t.assignee || t.assignee === "")
        break
      case "pending":
        result = result.filter(t => t.status === "pending")
        break
      case "in_progress":
        result = result.filter(t => t.status === "in_progress")
        break
      case "completed":
        result = result.filter(t => t.status === "completed")
        break
      // "all" - no filter
    }

    // Apply search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      )
    }

    return result
  }, [allTasks, filter, search])

  // Group tasks
  const unassignedTasks = filteredTasks.filter(t => !t.assignee || t.assignee === "")
  const tasksByAgent = useMemo(() => {
    const grouped = new Map<string, TaskWithAgent[]>()
    for (const task of filteredTasks) {
      if (!task.assignee || task.assignee === "") continue // skip unassigned
      const key = task.agentName
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(task)
    }
    // Sort by task count descending, then alphabetically
    return Array.from(grouped.entries())
      .sort((a, b) => {
        if (a[1].length !== b[1].length) return b[1].length - a[1].length
        return a[0].localeCompare(b[0])
      })
  }, [filteredTasks])

  const handleToggle = (task: TaskWithAgent) => {
    if (selectMode) {
      toggleTaskSelect(task.taskId)
      return
    }
    if (task.blockedBy.length > 0) return
    const next = task.status === "completed" ? "pending" : "completed"
    updateTask(task.agentId, task.taskId, next)
  }

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const handleToggleAll = useCallback(() => {
    setSelectedTaskIds(prev => {
      if (prev.size === filteredTasks.length) return new Set()
      return new Set(filteredTasks.map(t => t.taskId))
    })
  }, [filteredTasks])

  const handleBulkComplete = useCallback(() => {
    for (const taskId of selectedTaskIds) {
      const task = allTasks.find(t => t.taskId === taskId)
      if (task && task.status !== "completed" && task.blockedBy.length === 0) {
        updateTask(task.agentId, task.taskId, "completed")
      }
    }
    exitSelectMode()
  }, [selectedTaskIds, allTasks, updateTask, exitSelectMode])

  const handleBulkReset = useCallback(() => {
    for (const taskId of selectedTaskIds) {
      const task = allTasks.find(t => t.taskId === taskId)
      if (task && task.status === "completed") {
        updateTask(task.agentId, task.taskId, "pending")
      }
    }
    exitSelectMode()
  }, [selectedTaskIds, allTasks, updateTask, exitSelectMode])

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "unassigned", label: "Unassigned" },
    { id: "pending", label: "Pending" },
    { id: "in_progress", label: "In Progress" },
    { id: "completed", label: "Completed" },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search + toolbar actions */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
        <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded-md border border-border-default bg-surface-sunken/40 px-2 py-1">
          <Search className="h-3 w-3 text-muted/50 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch?.(e.target.value)}
            placeholder="Search tasks..."
            className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
          />
        </div>
        <button
          type="button"
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors shrink-0",
            selectMode
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
          )}
        >
          <CheckSquare className="h-3 w-3" />
          {selectMode ? "Done" : "Select"}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-subtle shrink-0 overflow-x-auto">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap shrink-0",
              filter === id
                ? "bg-surface-raised text-default"
                : "text-muted/50 hover:text-secondary hover:bg-surface-raised/40",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tasks list */}
      <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 space-y-2">
          {/* Unassigned section */}
          {unassignedTasks.length > 0 && (
            <div className="rounded-lg border border-accent/20 bg-accent/5 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection("unassigned")}
                className="w-full text-left px-2.5 py-2 hover:bg-accent/10 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronRight
                    size={12}
                    className={cn(
                      "shrink-0 text-accent transition-transform duration-(--duration-normal)",
                      expandedSections.has("unassigned") && "rotate-90",
                    )}
                  />
                  <Inbox className="h-3.5 w-3.5 text-accent shrink-0" />
                  <span className="text-xs font-semibold text-accent flex-1">
                    Unassigned
                  </span>
                  <span className="text-[9px] font-mono text-accent/70 bg-accent/10 px-1.5 py-px rounded">
                    {unassignedTasks.length}
                  </span>
                </div>
              </button>
              <Collapsible open={expandedSections.has("unassigned")}>
                <div className="space-y-px">
                  {unassignedTasks.map((task) => (
                    <TaskRow
                      key={task.taskId}
                      task={task}
                      onToggle={() => handleToggle(task)}
                      showAgent
                      selectMode={selectMode}
                      selected={selectedTaskIds.has(task.taskId)}
                    />
                  ))}
                </div>
              </Collapsible>
            </div>
          )}

          {/* Agent sections */}
          {tasksByAgent.map(([agentName, tasks]) => {
            const agent = agents.find(a => a.name === agentName)
            const isExpanded = expandedSections.has(agentName)
            return (
              <div key={agentName} className="rounded-lg border border-border-subtle overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSection(agentName)}
                  className="w-full text-left px-2.5 py-2 hover:bg-surface-raised/30 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronRight
                      size={12}
                      className={cn(
                        "shrink-0 text-muted transition-transform duration-(--duration-normal)",
                        isExpanded && "rotate-90",
                      )}
                    />
                    {agent && <AgentAvatar name={agent.name} size="sm" stopped={agent.lifecycleStatus === "stopped"} />}
                    <span className="text-xs font-medium text-default flex-1 truncate">
                      {agentName}
                    </span>
                    <span className="text-[9px] font-mono text-muted bg-surface-sunken/60 px-1.5 py-px rounded">
                      {tasks.length}
                    </span>
                  </div>
                </button>
                <Collapsible open={isExpanded}>
                  <div className="space-y-px bg-surface-sunken/20">
                    {tasks.map((task) => (
                      <TaskRow
                        key={task.taskId}
                        task={task}
                        onToggle={() => handleToggle(task)}
                        showAgent={false}
                        selectMode={selectMode}
                        selected={selectedTaskIds.has(task.taskId)}
                      />
                    ))}
                  </div>
                </Collapsible>
              </div>
            )
          })}

          {/* Empty state */}
          {filteredTasks.length === 0 && (
            <div className="py-8 text-center">
              <CheckSquare className="h-6 w-6 text-muted/20 mx-auto mb-1.5" />
              <p className="text-[11px] text-muted/50">No tasks found</p>
              {filter !== "all" && (
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="mt-2 text-[10px] text-accent hover:text-accent-hover"
                >
                  Show all tasks
                </button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bulk action bar */}
      {selectMode && (
        <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-sunken/30 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleAll}
            className="text-[11px] text-accent hover:text-accent-hover transition-colors shrink-0"
          >
            {selectedTaskIds.size === filteredTasks.length ? "Deselect all" : "Select all"}
          </button>
          <span className="text-[11px] text-muted shrink-0">
            {selectedTaskIds.size} selected
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={handleBulkReset}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
              selectedTaskIds.size > 0
                ? "text-muted hover:bg-surface-raised/40"
                : "text-muted/30 cursor-not-allowed",
            )}
            disabled={selectedTaskIds.size === 0}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleBulkComplete}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
              selectedTaskIds.size > 0
                ? "text-success hover:bg-success/10"
                : "text-muted/30 cursor-not-allowed",
            )}
            disabled={selectedTaskIds.size === 0}
          >
            <CheckCircle className="h-3 w-3" />
            Complete
          </button>
        </div>
      )}
    </div>
  )
}

function TaskRow({
  task,
  onToggle,
  showAgent,
  selectMode,
  selected,
}: {
  task: TaskWithAgent
  onToggle: () => void
  showAgent: boolean
  selectMode: boolean
  selected: boolean
}) {
  const isBlocked = task.blockedBy.length > 0
  const isCompleted = task.status === "completed"
  const isInProgress = task.status === "in_progress"

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!selectMode && isBlocked}
      className={cn(
        "w-full flex items-center gap-1.5 px-2.5 py-1 text-left transition-colors hover:bg-surface-raised/30",
        isInProgress && !selectMode && "border-l-2 border-accent",
        isCompleted && !selectMode && "opacity-50",
        !selectMode && isBlocked && "opacity-40 cursor-not-allowed",
        selectMode && selected && "bg-accent/5",
      )}
      style={{ height: 22 }}
    >
      {/* Checkbox / select / lock */}
      {selectMode ? (
        <div
          className={cn(
            "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
            selected
              ? "bg-accent/20 border-accent/50"
              : "border-border-default",
          )}
        >
          {selected && <Check className="h-2.5 w-2.5 text-accent" strokeWidth={3} />}
        </div>
      ) : isBlocked ? (
        <Lock size={10} className="text-muted/30 shrink-0" />
      ) : isCompleted ? (
        <CheckSquare size={10} className="text-success/60 shrink-0" />
      ) : (
        <Square size={10} className="text-muted/50 shrink-0" />
      )}

      {/* Title */}
      <span
        className={cn(
          "text-[10px] font-mono truncate flex-1 min-w-0",
          isCompleted && !selectMode && "line-through text-muted",
          (!isCompleted || selectMode) && "text-default",
        )}
      >
        {task.title}
      </span>

      {/* Agent pill */}
      {showAgent && task.agentName && (
        <span className="text-[8px] px-1 rounded bg-surface-sunken/60 text-muted font-mono shrink-0">
          {task.agentName}
        </span>
      )}

      {/* Status indicator */}
      {!selectMode && (
        <>
          {isInProgress ? (
            <Play size={8} className="text-accent animate-breathe shrink-0" />
          ) : task.status === "pending" ? (
            <Pause size={8} className="text-muted/40 shrink-0" />
          ) : (
            <Circle
              size={5}
              className={cn(
                "shrink-0 fill-current",
                isCompleted && "text-success/40",
              )}
            />
          )}
        </>
      )}
    </button>
  )
}
