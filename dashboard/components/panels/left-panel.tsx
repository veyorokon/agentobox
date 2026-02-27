"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import {
  Users,
  ChevronRight,
  ChevronLeft,
  Plus,
  KeyRound,
  ChevronsUpDown,
  ChevronsDownUp,
  BookOpen,
  Search,
  Filter,
  CheckSquare,
} from "lucide-react"
import { cn, formatCost } from "@/lib/utils"
import type { AttentionLevel } from "@/lib/types"
import { LIFECYCLE_CONFIG, ATTENTION_CONFIG } from "@/lib/config"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { useWindowWidth } from "@/hooks/use-window-width"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useAgents, useAcknowledgeAgent } from "@/lib/graphql/hooks/use-agents"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentAvatar } from "@/components/agent/avatar"
import { AgentCardRow } from "@/components/agent/card-row"
import { ResizeHandle } from "@/components/layout/resize-handle"
import { SkillsPanel } from "@/components/panels/skills-panel"

export function AgentLeftPanel({ onOpenSecrets, onCreateAgent }: { onOpenSecrets: () => void; onCreateAgent?: () => void }) {
  const bp = useBreakpoint()

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

  // ── Apollo (agents) ────────────────────────────────────────────────
  const { data } = useAgents()
  const agents = data?.agents ?? []
  const acknowledgeAgent = useAcknowledgeAgent()
  const allTags = useMemo(() => Array.from(new Set(agents.flatMap(a => a.tags ?? []))).sort(), [agents])

  // ── Layout metrics (derived from breakpoint + store) ───────────────
  const screenWidth = useWindowWidth()
  const collapseThreshold = Math.round(screenWidth * 0.2)
  const minPanelWidth = collapseThreshold + 20
  const defaultWidth = bp === "S" ? Math.max(minPanelWidth, 320) : bp === "M" ? Math.max(minPanelWidth, 340) : 480
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
    setSidebarWidth(Math.max(minPanelWidth, Math.min(720, next)))
  }, [defaultWidth, collapseThreshold, minPanelWidth, setSidebarOpen, setSidebarWidth])

  const handleToggleOpen = useCallback(() => {
    const currentOpen = useSidebarStore.getState().sidebarOpen
    if (!currentOpen) {
      const w = useSidebarStore.getState().sidebarWidth ?? defaultWidth
      setSidebarWidth(Math.max(w, collapseThreshold + 40))
    }
    setSidebarOpen(!currentOpen)
  }, [defaultWidth, collapseThreshold, setSidebarOpen, setSidebarWidth])

  // Ephemeral state — resets on unmount, single-component concern
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const tagDropdownRef = useRef<HTMLDivElement>(null)

  // Click-outside to close tag dropdown
  useEffect(() => {
    if (!showTagDropdown) return
    function handleClick(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) setShowTagDropdown(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showTagDropdown])

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

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  /* ---- Collapsed state: 48px icon rail ---- */
  if (!isOpen) {
    return (
      <aside className="group/rail w-12 h-full bg-surface-sunken border-r-[0.5px] border-border-default flex flex-col shrink-0 relative">
        {/* Hover edge hint — subtle accent line on right edge */}
        <div className="absolute top-0 bottom-0 right-0 w-px bg-transparent group-hover/rail:bg-accent/25 transition-colors" />

        {/* Project icon + secrets + cost */}
        <div className="pt-3 pb-1 flex flex-col items-center gap-1.5">
          <div className="h-6 w-6 rounded-md bg-accent/15 flex items-center justify-center text-[11px] font-bold text-accent">
            A
          </div>
          <button
            type="button"
            onClick={onOpenSecrets}
            className="p-1 rounded-md text-muted/50 hover:text-secondary hover:bg-surface-raised/50 transition-colors"
            title="Project secrets"
          >
            <KeyRound className="h-3 w-3" />
          </button>
          <span className="text-[8px] text-muted/50 font-mono tabular-nums">
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
            const hasAttention = agent.attentionLevel !== "none"
            const attCfg = hasAttention ? ATTENTION_CONFIG[agent.attentionLevel as Exclude<AttentionLevel, "none">] : null

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
                {/* Attention dot takes precedence over lifecycle dot */}
                {hasAttention && attCfg ? (
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface-sunken",
                      attCfg.dot,
                      attCfg.pulse && "animate-breathe",
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface-sunken",
                      config.dot,
                      isRunning && "animate-breathe text-success",
                    )}
                  />
                )}
                {isSelected && (
                  <span className="absolute inset-0 rounded-md ring-2 ring-accent/50" />
                )}
              </button>
            )
          })}
        </div>

        {/* Bottom: user avatar */}
        <div className="py-3 flex flex-col items-center border-t border-border-default">
          <div
            className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent cursor-pointer hover:ring-2 hover:ring-accent/30 transition-shadow"
            title="vahid"
          >
            V
          </div>
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
        <button
          type="button"
          className="inline-flex items-center gap-2 px-1 py-1 -ml-1 rounded-md hover:bg-surface-sunken/40 transition-colors min-w-0"
        >
          <div className="h-6 w-6 rounded-md bg-accent/15 flex items-center justify-center text-[11px] font-bold text-accent shrink-0">
            A
          </div>
          <span className="text-sm font-medium text-default truncate">agentobox</span>
          <ChevronRight size={12} className="text-muted/40 rotate-90 shrink-0" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenSecrets}
          className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
          title="Project secrets"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] text-muted/60 font-mono tabular-nums mx-1 shrink-0">
          {formatCost(totalCost)}
        </span>
        <button
          type="button"
          onClick={handleToggleOpen}
          className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
          title="Collapse panel"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Panel tabs: Agents | Skills */}
      <div className="h-7 px-3 flex items-center gap-1 border-b border-border-default shrink-0">
        <button
          type="button"
          onClick={() => setPanelTab("agents")}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
            panelTab === "agents"
              ? "bg-surface-raised text-default"
              : "text-muted hover:text-secondary hover:bg-surface-raised/30",
          )}
        >
          <Users className="h-3 w-3" />
          Agents
        </button>
        <button
          type="button"
          onClick={() => setPanelTab("skills")}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
            panelTab === "skills"
              ? "bg-surface-raised text-default"
              : "text-muted hover:text-secondary hover:bg-surface-raised/30",
          )}
        >
          <BookOpen className="h-3 w-3" />
          Skills
        </button>
        <span className="flex-1" />
        {panelTab === "agents" ? (
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
        ) : (
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
      {panelTab === "agents" ? (
        <>
          {/* Agent filter bar */}
          <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
            <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded-md border border-border-default bg-surface-sunken/40 px-2 py-1">
              <Search className="h-3 w-3 text-muted/50 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
              />
            </div>
            <div className="relative shrink-0" ref={tagDropdownRef}>
              <button
                type="button"
                onClick={() => setShowTagDropdown(!showTagDropdown)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
                  tagFilter
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
                )}
              >
                <Filter className="h-3 w-3" />
                {tagFilter || "Tags"}
                <ChevronRight size={10} className="rotate-90 text-muted/40" />
              </button>
              {showTagDropdown && (
                <div className="absolute top-full right-0 mt-1 w-32 rounded-md border border-border-default bg-surface-raised shadow-lg z-(--z-dropdown) overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setTagFilter(null); setShowTagDropdown(false) }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-[11px] transition-colors",
                      !tagFilter ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                    )}
                  >
                    All tags
                  </button>
                  {allTags.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => { setTagFilter(tag); setShowTagDropdown(false) }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors",
                        tagFilter === tag ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
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
            <button
              type="button"
              onClick={onCreateAgent}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 text-muted hover:text-secondary hover:bg-surface-raised/50"
            >
              <Plus className="h-3 w-3" />
              Create
            </button>
          </div>

          {/* Agent cards */}
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="p-3 space-y-2">
              {filteredAgents.map((agent) => (
                <AgentCardRow
                  key={agent.id}
                  agent={agent}
                  selectable={selectMode}
                  selected={selectedIds.has(agent.id)}
                  onSelect={() => handleSelectAgent(agent.id)}
                />
              ))}
              {filteredAgents.length === 0 && (
                <div className="py-6 text-center">
                  <Users className="h-5 w-5 text-muted/20 mx-auto mb-1" />
                  <p className="text-[11px] text-muted/50">No agents match filters</p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Bulk action bar — when in select mode */}
          {selectMode && (
            <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-sunken/30 flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (selectedIds.size === filteredAgents.length) {
                    setSelectedIds(new Set())
                  } else {
                    setSelectedIds(new Set(filteredAgents.map(a => a.id)))
                  }
                }}
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
                onClick={() => setSelectedIds(new Set())}
                className="text-[11px] text-muted hover:text-secondary transition-colors"
              >
                Clear
              </button>
            </div>
          )}

        </>
      ) : (
        <SkillsPanel />
      )}

      {/* Bottom: user avatar */}
      <div className="px-3 py-2 border-t border-border-default flex items-center shrink-0">
        <div
          className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent cursor-pointer hover:ring-2 hover:ring-accent/30 transition-shadow"
          title="vahid"
        >
          V
        </div>
      </div>
    </aside>
  )
}
