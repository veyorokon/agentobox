"use client"

import { useMemo, useCallback, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@apollo/client/react"
import {
  Users,
  ChevronRight,
  ChevronLeft,
  KeyRound,
  ChevronsUpDown,
  ChevronsDownUp,
  BookOpen,
  CheckSquare,
  Monitor,
  List,
  Settings,
  RotateCcw,
  Globe,
} from "lucide-react"
import { GET_PROJECT } from "@/lib/graphql/queries/projects"
import { cn, formatCost } from "@/lib/utils"
import type { ViewMode } from "@/lib/types"
import { LIFECYCLE_CONFIG } from "@/lib/config"
import { useBreakpoint } from "@/lib/hooks/use-breakpoint"
import { useWindowWidth } from "@/lib/hooks/use-window-width"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useAgents, useAcknowledgeAgent, useHardRestartAgent } from "@/lib/graphql/hooks/use-agents"
import { useProviderStatus } from "@/lib/graphql/hooks/use-models"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentAvatar } from "@/components/agent/avatar"
import { AgentCardRow } from "@/components/agent/card-row"
import { ResizeHandle } from "@/components/layout/resize-handle"
import { UserMenu } from "@/components/layout/user-menu"
import { ThemePicker } from "@/components/layout/theme-picker"
import { SkillsPanel } from "@/components/panels/skills-panel"
import { TasksPanel } from "@/components/panels/tasks-panel"
import { AgentFilterToolbar } from "@/components/shared/agent-filter-toolbar"
import { useSelectMode } from "@/lib/hooks/use-select-mode"

export function AgentLeftPanel({ onOpenSecrets, onCreateAgent }: { onOpenSecrets: () => void; onCreateAgent?: () => void }) {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const bp = useBreakpoint()

  // ── Project name ────────────────────────────────────────────────────
  const { data: projectData } = useQuery<{ project: { id: string; name: string } | null }>(GET_PROJECT, {
    variables: { id: projectId },
    skip: !projectId,
  })
  const projectName = projectData?.project?.name ?? ""

  // ── Sidebar store ──────────────────────────────────────────────────
  const isOpen = useSidebarStore(s => s.sidebarOpen)
  const setSidebarOpen = useSidebarStore(s => s.setSidebarOpen)
  const sidebarWidth = useSidebarStore(s => s.sidebarWidth)
  const setSidebarWidth = useSidebarStore(s => s.setSidebarWidth)
  const expandedIds = useSidebarStore(s => s.expandedAgentIds)
  const toggleAgent = useSidebarStore(s => s.toggleAgent)
  const toggleExpandAll = useSidebarStore(s => s.toggleExpandAll)
  const panelTab = useSidebarStore(s => s.sidebarTab)
  const setPanelTab = useSidebarStore(s => s.setSidebarTab)
  const searchQuery = useSidebarStore(s => s.agentSearch)
  const setSearchQuery = useSidebarStore(s => s.setAgentSearch)
  const tagFilter = useSidebarStore(s => s.agentTagFilter)
  const setTagFilter = useSidebarStore(s => s.setAgentTagFilter)
  const skillsAllExpanded = useSidebarStore(s => s.skillsAllExpanded)
  const toggleSkillsExpandAll = useSidebarStore(s => s.toggleSkillsExpandAll)
  const globalViewMode = useSidebarStore(s => s.globalViewMode)
  const setGlobalViewMode = useSidebarStore(s => s.setGlobalViewMode)

  // ── Apollo (agents + provider status) ─────────────────────────────
  const { providers } = useProviderStatus(projectId ?? "")
  const missingKeys = useMemo(() => providers.filter((p) => !p.configured), [providers])
  const { data, loading } = useAgents()
  const agents = data?.agents ?? []
  const acknowledgeAgent = useAcknowledgeAgent()
  const allTags = useMemo(() => Array.from(new Set(agents.flatMap(a => a.tags ?? []))).sort(), [agents])

  // ── Layout metrics (derived from breakpoint + store) ───────────────
  const screenWidth = useWindowWidth()
  const collapseThreshold = Math.round(screenWidth * 0.2)
  const minPanelWidth = collapseThreshold + 20
  const maxPanelWidth = Math.round(screenWidth * 0.5)
  const defaultWidth = bp === "S" ? Math.max(minPanelWidth, 520)
    : bp === "M" ? Math.max(minPanelWidth, 640)
    : bp === "L" ? 720
    : bp === "XL" ? 840
    : 960
  const width = sidebarWidth ?? defaultWidth

  // Reset custom width on breakpoint change
  useEffect(() => { setSidebarWidth(null) }, [bp, setSidebarWidth])

  // ── Handlers ───────────────────────────────────────────────────────

  const handleToggleAgent = useCallback((id: string) => {
    toggleAgent(id)
    acknowledgeAgent(id)
  }, [toggleAgent, acknowledgeAgent])

  const handleToggleExpandAll = useCallback(() => {
    toggleExpandAll(agents.map(a => a.id))
  }, [toggleExpandAll, agents])

  const handleResize = useCallback((delta: number) => {
    const current = useSidebarStore.getState().sidebarWidth ?? defaultWidth
    const next = current + delta
    if (next < collapseThreshold) {
      setSidebarOpen(false)
      setSidebarWidth(null)
      return
    }
    setSidebarWidth(Math.max(minPanelWidth, Math.min(maxPanelWidth, next)))
  }, [defaultWidth, collapseThreshold, minPanelWidth, maxPanelWidth, setSidebarOpen, setSidebarWidth])

  const handleToggleOpen = useCallback(() => {
    const currentOpen = useSidebarStore.getState().sidebarOpen
    if (!currentOpen) {
      const w = useSidebarStore.getState().sidebarWidth ?? defaultWidth
      setSidebarWidth(Math.max(w, collapseThreshold + 40))
    }
    setSidebarOpen(!currentOpen)
  }, [defaultWidth, collapseThreshold, setSidebarOpen, setSidebarWidth])

  // Ephemeral state — resets on unmount, single-component concern
  const { selectMode, selectedIds, setSelectMode, toggleSelect: handleSelectAgent, toggleAll, clearSelection, exitSelectMode } = useSelectMode<typeof agents[number]>()
  const hardRestartAgent = useHardRestartAgent()

  const handleBulkRedeploy = useCallback(() => {
    for (const id of selectedIds) {
      hardRestartAgent(id)
    }
    exitSelectMode()
  }, [selectedIds, hardRestartAgent, exitSelectMode])

  const totalCost = useMemo(() => agents.reduce((sum, a) => sum + a.cost, 0), [agents])

  const filteredAgents = useMemo(() => {
    let result = agents
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(a => a.name.toLowerCase().includes(q))
    }
    if (tagFilter) {
      result = result.filter(a => a.tags.includes(tagFilter))
    }
    return result
  }, [agents, searchQuery, tagFilter])

  /* ---- Collapsed state: 48px icon rail ---- */
  if (!isOpen) {
    return (
      <aside className="group/rail w-12 h-full bg-surface-sunken border-r-[0.5px] border-border-default flex flex-col shrink-0 relative">
        {/* Hover edge hint — subtle accent line on right edge */}
        <div className="absolute top-0 bottom-0 right-0 w-px bg-transparent group-hover/rail:bg-accent/25 transition-colors" />

        {/* Project icon + user + secrets + cost */}
        <div className="pt-3 pb-1 flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="h-6 w-6 rounded-md bg-surface-raised/50 flex items-center justify-center hover:bg-accent/15 transition-colors"
            title="Back to global"
          >
            <Globe className="h-3.5 w-3.5 text-muted hover:text-accent" />
          </button>
          <div
            className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-on-emphasis bg-accent cursor-pointer hover:ring-2 hover:ring-accent/30 transition-shadow"
            title="vahid-eyorokon"
          >
            V
          </div>
          <button
            type="button"
            onClick={onOpenSecrets}
            className="relative p-1 rounded-md text-muted/50 hover:text-secondary hover:bg-surface-raised/50 transition-colors"
            title={missingKeys.length > 0 ? `${missingKeys.length} key${missingKeys.length !== 1 ? "s" : ""} missing` : "Project secrets"}
          >
            <KeyRound className="h-3 w-3" />
          </button>
          <span className="text-[8px] text-secondary/70 font-mono tabular-nums">
            {formatCost(totalCost)}
          </span>
        </div>

        {/* Expand button */}
        <div className="flex justify-center pb-1.5 border-b border-border-subtle mb-1">
          <button
            type="button"
            onClick={handleToggleOpen}
            className="p-1 rounded-md text-muted/40 hover:text-accent hover:bg-accent/10 transition-colors"
            title="Expand panel"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Agent avatars */}
        <div className="flex-1 flex flex-col items-center gap-1.5 py-2 overflow-y-auto">
          {agents.map((agent) => {
            const config = LIFECYCLE_CONFIG[agent.lifecycleStatus]
            const isSelected = expandedIds.has(agent.id)
            const isRunning = agent.lifecycleStatus === "running"
            const isStopped = agent.lifecycleStatus === "stopped"
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  if (!expandedIds.has(agent.id)) handleToggleAgent(agent.id)
                  handleToggleOpen()
                }}
                className={cn(
                  "relative group",
                  isStopped && "opacity-55",
                )}
                title={agent.name}
              >
                <AgentAvatar name={agent.name} size="md" stopped={isStopped} />
                {isSelected && (
                  <span className="absolute inset-0 rounded-md ring-2 ring-accent/50" />
                )}
              </button>
            )
          })}
        </div>

      </aside>
    )
  }

  /* ---- Open state: resizable panel ---- */
  return (
    <aside
      className="relative h-full bg-surface border-r border-border-default flex flex-col shrink-0"
      style={{ width, minWidth: width }}
    >
      <ResizeHandle onResize={handleResize} onReset={() => setSidebarWidth(null)} side="right" />

      {/* Project selector + secrets + cost */}
      <div className="h-10 px-3 flex items-center border-b border-border-default shrink-0">
        <div className="inline-flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-1 px-1 py-1 -ml-1 rounded-md hover:bg-surface-sunken/40 transition-colors shrink-0"
            title="Back to global"
          >
            <Globe className="h-3.5 w-3.5 text-muted" />
          </button>
          <ChevronRight className="h-2.5 w-2.5 text-muted/30 shrink-0" />
          <span className="text-sm font-medium text-default truncate">
            {projectName || projectId}
          </span>
        </div>
        <span className="text-[10px] text-secondary/70 font-mono tabular-nums ml-1 shrink-0">
          {formatCost(totalCost)}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenSecrets}
          className="relative p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
          title={missingKeys.length > 0 ? `${missingKeys.length} key${missingKeys.length !== 1 ? "s" : ""} missing` : "Project secrets"}
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
        <ThemePicker className="shrink-0" />
        <UserMenu className="shrink-0">
          <div
            className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-on-emphasis bg-accent cursor-pointer hover:ring-2 hover:ring-accent/30 transition-shadow"
            title="vahid-eyorokon"
          >
            V
          </div>
        </UserMenu>
        <button
          type="button"
          onClick={handleToggleOpen}
          className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
          title="Collapse panel"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Panel tabs: Agents | Skills | Tasks */}
      <div className="h-7 px-3 flex items-center gap-1 border-b border-border-default shrink-0 min-w-0">
        <div className="flex items-center gap-0.5 shrink-0">
          {([
            { id: "agents" as const, icon: Users, label: "Agents" },
            { id: "skills" as const, icon: BookOpen, label: "Skills" },
            { id: "tasks" as const, icon: CheckSquare, label: "Tasks" },
          ]).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPanelTab(id)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0",
                panelTab === id
                  ? "bg-surface-raised text-default"
                  : "text-muted hover:text-secondary hover:bg-surface-raised/30",
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
        <span className="flex-1 min-w-0" />
        {panelTab === "agents" && (
          <>
            {/* Global view mode — switches all expanded cards at once */}
            <div className="flex items-center gap-0.5 mr-1">
              {([
                { id: "terminal" as ViewMode, icon: Monitor, label: "All screens" },
                { id: "feed" as ViewMode, icon: List, label: "All feeds" },
                { id: "tasks" as ViewMode, icon: CheckSquare, label: "All tasks" },
                { id: "skills" as ViewMode, icon: BookOpen, label: "All skills" },
                { id: "settings" as ViewMode, icon: Settings, label: "All settings" },
              ]).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGlobalViewMode(globalViewMode === id ? null : id)}
                  className={cn(
                    "p-0.5 rounded transition-colors",
                    globalViewMode === id
                      ? "bg-accent/15 text-accent"
                      : "text-muted/40 hover:text-secondary hover:bg-surface-raised/40",
                  )}
                  title={label}
                >
                  <Icon className="h-3 w-3" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleToggleExpandAll}
              className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
              title="Cycle card states"
            >
              {expandedIds.size > 0 ? (
                <ChevronsDownUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        )}
        {panelTab === "skills" && (
          <button
            type="button"
            onClick={toggleSkillsExpandAll}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
            title={skillsAllExpanded ? "Collapse all" : "Expand all"}
          >
            {skillsAllExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Tab content */}
      {panelTab === "agents" && (
        <>
          {/* Agent filter bar */}
          <AgentFilterToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            tags={allTags}
            selectedTag={tagFilter}
            onTagChange={setTagFilter}
            selectMode={selectMode}
            onSelectToggle={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            onCreateClick={onCreateAgent}
          />

          {/* Bulk action bar — replaces bottom bar, sits above cards */}
          {selectMode && (
            <div className="px-3 py-1.5 border-b border-border-subtle bg-surface-sunken/30 flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => toggleAll(filteredAgents)}
                className="text-[11px] text-accent hover:text-accent-hover transition-colors shrink-0"
              >
                {selectedIds.size === filteredAgents.length ? "Deselect all" : "Select all"}
              </button>
              <span className="text-[11px] font-medium text-default shrink-0">
                {selectedIds.size} selected
              </span>
              <span className="flex-1" />
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={handleBulkRedeploy}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                  selectedIds.size > 0
                    ? "text-accent hover:bg-accent/10"
                    : "text-muted/40 cursor-not-allowed",
                )}
              >
                <RotateCcw className="h-3 w-3" />
                Redeploy
              </button>
            </div>
          )}

          {/* Agent cards */}
          <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-3 space-y-2">
              {loading && agents.length === 0 && (
                <div className="space-y-2">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="rounded-lg border border-border-subtle bg-surface p-2.5 animate-pulse">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-surface-sunken/60" />
                        <div className="h-3 w-16 rounded bg-surface-sunken/60" />
                        <div className="h-2.5 w-10 rounded-full bg-surface-sunken/40" />
                        <div className="flex-1" />
                        <div className="h-2 w-20 rounded bg-surface-sunken/40" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {filteredAgents.map((agent) => (
                <AgentCardRow
                  key={agent.id}
                  agent={agent}
                  selectable={selectMode}
                  selected={selectedIds.has(agent.id)}
                  onSelect={() => handleSelectAgent(agent.id)}
                />
              ))}
              {filteredAgents.length === 0 && !loading && (
                <div className="py-6 text-center">
                  <Users className="h-5 w-5 text-muted/20 mx-auto mb-1" />
                  <p className="text-[11px] text-muted/50">No agents match filters</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}

      {panelTab === "skills" && <SkillsPanel />}

      {panelTab === "tasks" && <TasksPanel />}

    </aside>
  )
}
