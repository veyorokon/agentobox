"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import {
  Search,
  Filter,
  ChevronRight,
  CheckSquare,
  Plus,
  Users,
  ChevronsUpDown,
  ChevronsDownUp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ALL_TAGS } from "@/lib/data/mock"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useTeamStore } from "@/lib/stores/team"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentCardRow } from "@/components/agent/card-row"

export function AgentCardsPanel() {
  // ── Sidebar store ──────────────────────────────────────────────────
  const expandedIds = useSidebarStore(s => s.expandedAgentIds)
  const toggleExpandAll = useSidebarStore(s => s.toggleExpandAll)
  const searchQuery = useSidebarStore(s => s.agentSearch)
  const setSearchQuery = useSidebarStore(s => s.setAgentSearch)
  const tagFilter = useSidebarStore(s => s.agentTagFilter)
  const setTagFilter = useSidebarStore(s => s.setAgentTagFilter)

  // ── Team store ─────────────────────────────────────────────────────
  const agents = useTeamStore(s => s.agents)

  // Ephemeral state
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
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

  const filteredAgents = useMemo(() => {
    let result = agents
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(a => a.name.toLowerCase().includes(q) || a.tags.some(t => t.includes(q)))
    }
    if (tagFilter) {
      result = result.filter(a => a.tags.includes(tagFilter))
    }
    return result
  }, [agents, searchQuery, tagFilter])

  const handleSelectAgent = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  return (
    <>
      {/* Toolbar: search + tags + select + create + expand */}
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
              {ALL_TAGS.map(tag => (
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
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 text-muted hover:text-secondary hover:bg-surface-raised/50"
        >
          <Plus className="h-3 w-3" />
          Create
        </button>
        <button
          type="button"
          onClick={() => toggleExpandAll(agents.map(a => a.id))}
          className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
          title="Cycle card states"
        >
          {expandedIds.size > 0 ? (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
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
    </>
  )
}
