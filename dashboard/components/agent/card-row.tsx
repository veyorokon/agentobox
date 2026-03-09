"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import {
  ArrowUp,
  ChevronRight,
  Check,
  CheckSquare,
  Monitor,
  List,
  BookOpen,
  Settings,
  MoreVertical,
  Square,
  RotateCcw,
  Rocket,
  Trash2,
  Pause,
  Play,
  Plus,
  Bell,
  BellOff,
} from "lucide-react"
import { cn, formatCost, formatComputeTime, formatTriggerSubtitle } from "@/lib/utils"
import { LIFECYCLE_CONFIG, MODE_CONFIG } from "@/lib/config"
import { getPendingItemsForAgent } from "@/lib/attention"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useAcknowledgeAgent, useSetAgentMode, useInterruptAgent, useRestartAgent, useHardRestartAgent, useRemoveAgent } from "@/lib/graphql/hooks/use-agents"
import { useFeed, useResolvePermission, useResolvePlan, useSendMessage } from "@/lib/graphql/hooks/use-feed"
import { useAgentTasks, useCreateTask } from "@/lib/graphql/hooks/use-tasks"
import { useSkills } from "@/lib/graphql/hooks/use-skills"
import { dismissSkillForAgent, getUndismissedSkills } from "@/lib/skill-notifications"
import { Collapsible } from "@/components/ui/collapsible"
import { AgentTag } from "@/components/agent/avatar"
import { ModePill } from "@/components/agent/mode-pill"
import { VncThumbnail } from "@/components/agent/vnc-thumbnail"
import { AgentDetailFeed } from "@/components/agent/detail-feed"
import { AgentSettingsPanel, type SettingsPanelHandle } from "@/components/agent/settings-panel"
import { AgentSkillsView } from "@/components/agent/skills-view"
import { AgentTasksView } from "@/components/agent/tasks-view"
import { CardActionStrip } from "@/components/agent/card-action-strip"
import { useClickOutside } from "@/lib/hooks/use-click-outside"
import type { Agent, CardActionItem, ViewMode } from "@/lib/types"

export interface AgentCardRowProps {
  agent: Agent
  selectable?: boolean
  selected?: boolean
  onSelect?: () => void
}

/**
 * Agent card -- two states:
 *
 * COLLAPSED -- compact single row:
 *   status dot | avatar | name | mode | tags | live action | cost . time | chevron
 *
 * OPEN -- content area + bottom toolbar:
 *   header row -> content (VNC / feed / settings) -> toolbar (view icons + composer + tasks)
 */
export function AgentCardRow({
  agent,
  selectable = false,
  selected = false,
  onSelect,
}: AgentCardRowProps) {
  const config = LIFECYCLE_CONFIG[agent.lifecycleStatus]
  const isRunning = agent.lifecycleStatus === "running"
  const isError = agent.lifecycleStatus === "error"
  const isStopped = agent.lifecycleStatus === "stopped"

  // Store state — card subscribes to exactly the slices it needs
  const isExpanded = useSidebarStore(s => s.expandedAgentIds.has(agent.id))
  const isMuted = useSidebarStore(s => s.mutedAgentIds.has(agent.id))
  const toggleAgent = useSidebarStore(s => s.toggleAgent)
  const expandAgent = useSidebarStore(s => s.expandAgent)
  const toggleMuteAgent = useSidebarStore(s => s.toggleMuteAgent)
  const acknowledgeAgent = useAcknowledgeAgent()
  const setAgentMode = useSetAgentMode()
  const { data: feedData } = useFeed()
  const feedItems = feedData?.feed ?? []
  const resolvePermission = useResolvePermission()
  const resolvePlan = useResolvePlan()
  const sendMessage = useSendMessage()
  const interruptAgent = useInterruptAgent()
  const restartAgent = useRestartAgent()
  const hardRestartAgent = useHardRestartAgent()
  const removeAgent = useRemoveAgent()
  const handleModeChange = (mode: Agent["mode"]) => setAgentMode(agent.id, mode)
  const triggerSubtitle = formatTriggerSubtitle(agent.triggers)

  // Tasks data and counts
  const { tasks } = useAgentTasks(agent.id, agent.taskProgress)
  const createTask = useCreateTask()
  const taskCounts = useMemo(() => ({
    pending: tasks.filter(t => t.status === "pending").length,
    inProgress: tasks.filter(t => t.status === "in_progress").length,
    completed: tasks.filter(t => t.status === "completed").length,
  }), [tasks])

  // Skills data — check for new skills matching this agent
  const { data: skillsData } = useSkills()
  const skills = skillsData?.skills ?? []
  const [dismissedSkillIds, setDismissedSkillIds] = useState<string[]>([])

  const newSkills = useMemo(() => {
    const matchingSkills = skills.filter(
      s => s.assignedToAll || agent.tags.some(t => s.assignedTags.includes(t))
    )
    const undismissed = getUndismissedSkills(agent.id, matchingSkills.map(s => s.id))
    return matchingSkills.filter(s => undismissed.includes(s.id) && !dismissedSkillIds.includes(s.id))
  }, [skills, agent.tags, agent.id, dismissedSkillIds])

  // Quick add task state
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddText, setQuickAddText] = useState("")
  const [quickAddDescription, setQuickAddDescription] = useState("")
  const quickAddRef = useRef<HTMLDivElement>(null)

  // Kebab menu state
  const [kebabOpen, setKebabOpen] = useState(false)
  const kebabRef = useRef<HTMLDivElement>(null)

  // Derived from store
  const isOpen = !selectable && isExpanded
  const pendingItems = useMemo(() => getPendingItemsForAgent(feedItems, agent.name), [feedItems, agent.name])

  // Settings panel ref + dirty state
  const settingsRef = useRef<SettingsPanelHandle>(null)
  const [settingsDirty, setSettingsDirty] = useState(false)

  // Ephemeral state — view tab resets when card collapses
  const [viewMode, setViewMode] = useState<ViewMode>("terminal")
  const [composerText, setComposerText] = useState("")

  // Sync with global view mode broadcast
  const globalViewMode = useSidebarStore(s => s.globalViewMode)
  useEffect(() => {
    if (globalViewMode) setViewMode(globalViewMode)
  }, [globalViewMode])

  // Close kebab on outside click
  const closeKebab = useCallback(() => setKebabOpen(false), [])
  useClickOutside(kebabRef, closeKebab, kebabOpen)

  // Close quick add on outside click
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), [])
  useClickOutside(quickAddRef, closeQuickAdd, quickAddOpen)

  const handleSendMessage = () => {
    const text = composerText.trim()
    if (!text) return
    sendMessage(text, [{ type: "agent", value: agent.name }])
    setComposerText("")
  }

  const handleQuickAdd = () => {
    const text = quickAddText.trim()
    if (!text) return
    createTask(agent.id, text, quickAddDescription.trim())
    setQuickAddText("")
    setQuickAddDescription("")
    setQuickAddOpen(false)
  }

  const handleDismissSkill = useCallback((skillId: string) => {
    dismissSkillForAgent(agent.id, skillId)
    setDismissedSkillIds(prev => [...prev, skillId])
  }, [agent.id])

  const handleViewSkill = useCallback(() => {
    setViewMode("skills")
  }, [])

  // Build unified action items: permissions → plans → new skills → config-dirty
  const actionItems = useMemo(() => {
    const items: CardActionItem[] = []
    for (const p of pendingItems) {
      if (p.type === "permission") items.push({ kind: "permission", feedItem: p })
      else if (p.type === "plan") items.push({ kind: "plan", feedItem: p })
    }
    // Add new skill notifications
    for (const skill of newSkills) {
      items.push({ kind: "new-skill", skillId: skill.id, skillName: skill.name })
    }
    if (viewMode === "settings" && settingsDirty) {
      items.push({ kind: "config-dirty" })
    }
    return items
  }, [pendingItems, newSkills, viewMode, settingsDirty])

  // Auto-expand on new activity (unless muted)
  const prevActivityCount = useRef(0)
  useEffect(() => {
    const currentActivityCount = pendingItems.length + newSkills.length
    const hadPreviousActivity = prevActivityCount.current > 0
    const hasNewActivity = currentActivityCount > prevActivityCount.current

    prevActivityCount.current = currentActivityCount

    // Auto-expand if: not muted, not already expanded, has new activity, and not the first render
    if (!isMuted && !isExpanded && hasNewActivity && hadPreviousActivity) {
      expandAgent(agent.id)
    }
  }, [pendingItems.length, newSkills.length, isMuted, isExpanded, expandAgent, agent.id])


  const VIEW_MODES: { id: ViewMode; icon: typeof Monitor; label: string }[] = [
    { id: "terminal", icon: Monitor, label: "Screen" },
    { id: "feed", icon: List, label: "Feed" },
    { id: "skills", icon: BookOpen, label: "Skills" },
    { id: "settings", icon: Settings, label: "Settings" },
  ]

  return (
    <div
      className={cn(
        "rounded-lg border transition-all duration-(--duration-normal) select-none",
        isOpen
          ? cn("border-accent/40 bg-surface-raised/80 shadow-sm", isError && "border-danger/40")
          : cn(
              "border-border-subtle bg-surface hover:bg-surface-raised/40 hover:border-border-default",
              isError && "border-danger/30 hover:border-danger/40",
              isStopped && "opacity-60",
            ),
      )}
    >
      {/* Header row -- div instead of button to allow nested interactive ModePill */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (selectable && onSelect) {
            onSelect()
          } else {
            toggleAgent(agent.id)
            acknowledgeAgent(agent.id)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            if (selectable && onSelect) onSelect()
            else { toggleAgent(agent.id); acknowledgeAgent(agent.id) }
          }
        }}
        className="w-full text-left px-2.5 py-2 cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectable && (
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
          )}
          {/* Status dot — first visual element, morphs to stop button on hover when running */}
          {isRunning ? (
            <button
              type="button"
              title="Interrupt agent"
              onClick={(e) => { e.stopPropagation(); interruptAgent(agent.id) }}
              className="group/dot relative h-4 w-4 flex items-center justify-center shrink-0"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-breathe group-hover/dot:hidden" />
              <Square className="h-2.5 w-2.5 text-warning hidden group-hover/dot:block" strokeWidth={3} />
            </button>
          ) : (
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                config.dot,
              )}
            />
          )}
          <AgentTag name={agent.name} className={cn("text-[12px]", isStopped && "opacity-50")} />
          <ModePill mode={agent.mode} onChange={handleModeChange} />
          {/* Tag pills -- show 1 + overflow count, shrink before mode */}
          {agent.tags.length > 0 && (
            <span className="inline-flex items-center gap-1 shrink min-w-0 overflow-hidden">
              <span className="px-1.5 py-px rounded text-[9px] font-mono text-muted bg-surface-sunken/60 border border-border-subtle truncate">
                {agent.tags[0]}
              </span>
              {agent.tags.length > 1 && (
                <span className="text-[9px] text-muted/40 font-mono shrink-0">+{agent.tags.length - 1}</span>
              )}
            </span>
          )}

          {/* Live action one-liner */}
          {agent.liveAction ? (
            <span className="text-[10px] text-muted font-mono truncate flex-1 min-w-0">
              {agent.liveAction}
            </span>
          ) : (
            <span className="text-[10px] text-muted/50 font-mono truncate flex-1 min-w-0">
              {agent.task}
            </span>
          )}

          {/* Right: cost · time + mute + kebab + chevron */}
          <span className="text-[9px] text-muted/60 font-mono tabular-nums shrink-0">
            {formatCost(agent.cost)} · {formatComputeTime(agent.computeSeconds ?? 0)}
          </span>

          {/* Mute auto-expand button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleMuteAgent(agent.id) }}
            className={cn(
              "p-0.5 rounded transition-colors",
              isMuted
                ? "text-muted/40 hover:text-secondary hover:bg-surface-raised/40"
                : "text-accent/60 hover:text-accent hover:bg-accent/10",
            )}
            title={isMuted ? "Enable auto-expand on activity" : "Disable auto-expand on activity"}
          >
            {isMuted ? (
              <BellOff className="h-3 w-3" />
            ) : (
              <Bell className="h-3 w-3" />
            )}
          </button>

          {/* Kebab menu — interrupt / restart / remove */}
          <div ref={kebabRef} className="relative shrink-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setKebabOpen(v => !v) }}
              className={cn(
                "p-0.5 rounded transition-colors",
                kebabOpen
                  ? "bg-surface-raised text-default"
                  : "text-muted/40 hover:text-secondary hover:bg-surface-raised/40",
              )}
              title="Agent actions"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {kebabOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border-default bg-surface-raised shadow-lg py-0.5">
                {isRunning && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); interruptAgent(agent.id); setKebabOpen(false) }}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-default hover:bg-surface-sunken/40 flex items-center gap-2"
                  >
                    <Square className="h-3 w-3 text-warning" strokeWidth={2.5} />
                    Interrupt
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); restartAgent(agent.id); setKebabOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-default hover:bg-surface-sunken/40 flex items-center gap-2"
                >
                  <RotateCcw className="h-3 w-3 text-muted" />
                  Restart
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); hardRestartAgent(agent.id); setKebabOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-default hover:bg-surface-sunken/40 flex items-center gap-2"
                >
                  <Rocket className="h-3 w-3 text-accent" strokeWidth={2.5} />
                  Redeploy
                </button>
                <div className="border-t border-border-subtle my-0.5" />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeAgent(agent.id); setKebabOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-danger hover:bg-danger-subtle/40 flex items-center gap-2"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              </div>
            )}
          </div>

          <ChevronRight
            size={14}
            className={cn(
              "shrink-0 text-muted transition-transform duration-(--duration-normal)",
              isOpen && "rotate-90",
            )}
          />
        </div>
        {triggerSubtitle && (
          <div className="flex items-center gap-1 mt-0.5 pl-1">
            <span className="text-[9px] text-muted/50 font-mono truncate">
              &#x26A1; {triggerSubtitle}
            </span>
          </div>
        )}
      </div>

      {/* Open content -- animated reveal */}
      <Collapsible open={isOpen}>
        {/* Content area -- VNC sets height, other views absolute-overlay and scroll within */}
        <div>
          <div className="relative">
            <div className={cn(viewMode !== "terminal" && "invisible")}>
              <VncThumbnail key={agent.id} agent={agent} />
            </div>
            {viewMode === "feed" && (
              <div className="absolute inset-0 overflow-y-auto px-3 pb-2">
                <AgentDetailFeed agent={agent} />
              </div>
            )}
            {viewMode === "skills" && (
              <div className="absolute inset-0 overflow-y-auto px-3 pb-2">
                <AgentSkillsView agent={agent} />
              </div>
            )}
            {viewMode === "tasks" && (
              <div className="absolute inset-0 overflow-y-auto px-3 pb-2">
                <AgentTasksView agent={agent} />
              </div>
            )}
            {viewMode === "settings" && (
              <div className="absolute inset-0 overflow-y-auto px-3 pb-2">
                <AgentSettingsPanel ref={settingsRef} agent={agent} onDirtyChange={setSettingsDirty} />
              </div>
            )}
          </div>
        </div>

        {/* Attention bar — actionable items only: permissions, plans, new skills, config-dirty */}
        <CardActionStrip
          items={actionItems}
          onResolvePermission={resolvePermission}
          onResolvePlan={resolvePlan}
          onRestart={() => settingsRef.current?.restart()}
          onRedeploy={() => settingsRef.current?.redeploy()}
          onDismissSkill={handleDismissSkill}
          onViewSkill={handleViewSkill}
        />

        {/* Bottom toolbar -- always present: view icons + composer + tasks */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-border-subtle bg-surface-sunken/20">
          {/* View mode icons */}
          <div className="flex items-center gap-0.5 shrink-0">
            {VIEW_MODES.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                className={cn(
                  "p-1 rounded transition-colors",
                  viewMode === id
                    ? "bg-surface-raised text-default"
                    : "text-muted/50 hover:text-secondary hover:bg-surface-raised/40",
                )}
                title={label}
              >
                <Icon className="h-3 w-3" />
              </button>
            ))}
          </div>

          {/* Mini composer */}
          <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded border border-border-default bg-surface-sunken/40 px-2 py-1">
            <span className="text-[9px] text-accent font-mono shrink-0">@{agent.name}</span>
            <input
              type="text"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }}
              placeholder="Message..."
              className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
            />
            <button
              type="button"
              onClick={handleSendMessage}
              className={cn(
                "flex items-center justify-center h-4 w-4 rounded-full shrink-0 transition-colors",
                composerText.trim()
                  ? "bg-accent text-on-emphasis"
                  : "bg-surface text-muted",
              )}
            >
              <ArrowUp className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          </div>

          {/* Task status segments — compact inline display */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Pending tasks segment */}
            <button
              type="button"
              onClick={() => setViewMode("tasks")}
              className={cn(
                "flex items-center gap-0.5 px-1 py-0.5 rounded-l transition-colors",
                viewMode === "tasks"
                  ? "bg-accent/15 text-accent"
                  : taskCounts.pending > 0
                    ? "text-muted/70 hover:text-secondary hover:bg-surface-raised/40"
                    : "text-muted/30 hover:text-muted/50 hover:bg-surface-raised/20",
              )}
              title={taskCounts.pending > 0
                ? `${taskCounts.pending} pending: ${tasks.filter(t => t.status === "pending").map(t => t.title).slice(0, 3).join(", ")}${tasks.filter(t => t.status === "pending").length > 3 ? "..." : ""}`
                : "No pending tasks"}
            >
              <Pause className="h-2.5 w-2.5" />
              <span className="text-[8px] font-mono tabular-nums">{taskCounts.pending}</span>
            </button>

            {/* In-progress tasks segment */}
            <button
              type="button"
              onClick={() => setViewMode("tasks")}
              className={cn(
                "flex items-center gap-0.5 px-1 py-0.5 transition-colors border-x border-border-subtle",
                viewMode === "tasks"
                  ? "bg-accent/15 text-accent"
                  : taskCounts.inProgress > 0
                    ? "text-accent hover:text-accent/80 hover:bg-accent/10"
                    : "text-muted/30 hover:text-muted/50 hover:bg-surface-raised/20",
              )}
              title={taskCounts.inProgress > 0
                ? `${taskCounts.inProgress} in progress: ${tasks.filter(t => t.status === "in_progress").map(t => t.title).slice(0, 3).join(", ")}${tasks.filter(t => t.status === "in_progress").length > 3 ? "..." : ""}`
                : "No tasks in progress"}
            >
              <Play className={cn("h-2.5 w-2.5", taskCounts.inProgress > 0 && "animate-breathe")} />
              <span className="text-[8px] font-mono tabular-nums">{taskCounts.inProgress}</span>
            </button>

            {/* Completed tasks segment */}
            <button
              type="button"
              onClick={() => setViewMode("tasks")}
              className={cn(
                "flex items-center gap-0.5 px-1 py-0.5 rounded-r transition-colors",
                viewMode === "tasks"
                  ? "bg-accent/15 text-accent"
                  : taskCounts.completed > 0
                    ? "text-success/60 hover:text-success/80 hover:bg-success-subtle/20"
                    : "text-muted/30 hover:text-muted/50 hover:bg-surface-raised/20",
              )}
              title={taskCounts.completed > 0
                ? `${taskCounts.completed} completed: ${tasks.filter(t => t.status === "completed").map(t => t.title).slice(0, 3).join(", ")}${tasks.filter(t => t.status === "completed").length > 3 ? "..." : ""}`
                : "No completed tasks"}
            >
              <Check className="h-2.5 w-2.5" />
              <span className="text-[8px] font-mono tabular-nums">{taskCounts.completed}</span>
            </button>

            {/* Quick add button */}
            <div ref={quickAddRef} className="relative">
              <button
                type="button"
                onClick={() => setQuickAddOpen(v => !v)}
                className={cn(
                  "ml-0.5 p-0.5 rounded transition-colors",
                  quickAddOpen
                    ? "bg-accent/15 text-accent"
                    : "text-muted/40 hover:text-secondary hover:bg-surface-raised/40",
                )}
                title="Add task"
              >
                <Plus className="h-3 w-3" />
              </button>

              {/* Quick add popover */}
              {quickAddOpen && (
                <div className="absolute right-0 bottom-full mb-1 z-50 min-w-[240px] rounded-md border border-border-default bg-surface-raised shadow-lg p-2">
                  <input
                    type="text"
                    value={quickAddText}
                    onChange={(e) => setQuickAddText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleQuickAdd()
                      }
                      if (e.key === "Escape") {
                        setQuickAddOpen(false)
                        setQuickAddText("")
                        setQuickAddDescription("")
                      }
                    }}
                    placeholder="Task title..."
                    autoFocus
                    className="w-full bg-surface-sunken/40 border border-border-subtle rounded px-2 py-1 text-[10px] text-default placeholder:text-muted/40 outline-none focus:border-accent/40"
                  />
                  <textarea
                    value={quickAddDescription}
                    onChange={(e) => setQuickAddDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.metaKey) {
                        e.preventDefault()
                        handleQuickAdd()
                      }
                      if (e.key === "Escape") {
                        setQuickAddOpen(false)
                        setQuickAddText("")
                        setQuickAddDescription("")
                      }
                    }}
                    placeholder="Description (optional)..."
                    rows={2}
                    className="w-full mt-1.5 bg-surface-sunken/40 border border-border-subtle rounded px-2 py-1 text-[10px] text-default placeholder:text-muted/40 outline-none focus:border-accent/40 resize-none"
                  />
                  <div className="flex items-center justify-end gap-1 mt-1.5">
                    <button
                      type="button"
                      onClick={() => { setQuickAddOpen(false); setQuickAddText(""); setQuickAddDescription("") }}
                      className="px-2 py-0.5 rounded text-[9px] text-muted hover:text-default hover:bg-surface-sunken/40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleQuickAdd}
                      disabled={!quickAddText.trim()}
                      className={cn(
                        "px-2 py-0.5 rounded text-[9px] font-medium transition-colors",
                        quickAddText.trim()
                          ? "bg-accent text-on-emphasis hover:bg-accent/90"
                          : "bg-surface-sunken text-muted/40 cursor-not-allowed",
                      )}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Collapsible>
    </div>
  )
}
