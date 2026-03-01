"use client"

import { useMemo } from "react"
import {
  Users,
  ChevronsUpDown,
  ChevronsDownUp,
} from "lucide-react"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useAgents } from "@/lib/graphql/hooks/use-agents"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentCardRow } from "@/components/agent/card-row"
import { AgentFilterToolbar } from "@/components/shared/agent-filter-toolbar"
import { useSelectMode } from "@/lib/hooks/use-select-mode"

export function AgentCardsPanel() {
  // ── Sidebar store ──────────────────────────────────────────────────
  const expandedIds = useSidebarStore(s => s.expandedAgentIds)
  const toggleExpandAll = useSidebarStore(s => s.toggleExpandAll)
  const searchQuery = useSidebarStore(s => s.agentSearch)
  const setSearchQuery = useSidebarStore(s => s.setAgentSearch)
  const tagFilter = useSidebarStore(s => s.agentTagFilter)
  const setTagFilter = useSidebarStore(s => s.setAgentTagFilter)

  // ── Apollo (agents) ────────────────────────────────────────────────
  const { data, loading } = useAgents()
  const agents = data?.agents ?? []
  const allTags = useMemo(() => Array.from(new Set(agents.flatMap(a => a.tags ?? []))).sort(), [agents])

  // Ephemeral state
  const { selectMode, selectedIds, setSelectMode, toggleSelect: handleSelectAgent, exitSelectMode } = useSelectMode<typeof agents[number]>()

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

  return (
    <>
      {/* Toolbar: search + tags + select + create + expand */}
      <AgentFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        tags={allTags}
        selectedTag={tagFilter}
        onTagChange={setTagFilter}
        selectMode={selectMode}
        onSelectToggle={() => selectMode ? exitSelectMode() : setSelectMode(true)}
        onCreateClick={() => {}}
        trailing={
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
        }
      />

      {/* Agent cards */}
      <ScrollArea className="flex-1 overflow-y-auto">
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
  )
}
