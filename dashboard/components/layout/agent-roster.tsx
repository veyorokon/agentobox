"use client"

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react"
import { Plus, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentRosterItem } from "@/components/layout/agent-roster-item"
import { UserMenu } from "@/components/layout/user-menu"
import type { Agent } from "@/types"

type AgentRosterProps = {
  agents: Agent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
  onAddAgent?: () => void
  projectName?: string
  username?: string | null
  email?: string | null
}

/* ------------------------------------------------------------------ */
/*  Sorting                                                            */
/* ------------------------------------------------------------------ */

const STATUS_ORDER: Record<string, number> = {
  error: 0,
  waiting: 1,
  running: 2,
  deploying: 3,
  idle: 4,
  stopped: 5,
}

/** Status groups that get visual separators in the list. */
const STATUS_GROUP_LABELS: Record<string, string> = {
  error: "Errors",
  waiting: "Waiting",
  running: "Active",
  deploying: "Starting",
  idle: "Idle",
  stopped: "Stopped",
}

function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aOrder = STATUS_ORDER[a.status] ?? 99
    const bOrder = STATUS_ORDER[b.status] ?? 99
    if (aOrder !== bOrder) return aOrder - bOrder
    return a.name.localeCompare(b.name)
  })
}

/**
 * Normalize a status string to one of the known group keys.
 * Unknown statuses map to "stopped" visually.
 */
function statusGroup(status: string): string {
  return STATUS_ORDER[status] !== undefined ? status : "stopped"
}

/* ------------------------------------------------------------------ */
/*  Fleet health pills                                                 */
/* ------------------------------------------------------------------ */

type StatusPillConfig = {
  key: string
  dot: string
  text: string
  animate?: boolean
}

const PILL_CONFIG: StatusPillConfig[] = [
  { key: "error", dot: "bg-danger", text: "text-danger" },
  { key: "running", dot: "bg-success", text: "text-success", animate: true },
  { key: "idle", dot: "bg-info", text: "text-muted" },
  { key: "stopped", dot: "bg-muted/40", text: "text-muted/50" },
]

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function AgentRoster({
  agents,
  selectedAgentId,
  onSelectAgent,
  onAddAgent,
  projectName,
  username,
  email,
}: AgentRosterProps) {
  const [filterText, setFilterText] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isSearching) {
      searchInputRef.current?.focus()
    }
  }, [isSearching])

  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setFilterText("")
        setIsSearching(false)
      }
    },
    [],
  )

  /* Status counts */
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      running: 0,
      error: 0,
      idle: 0,
      stopped: 0,
      waiting: 0,
      deploying: 0,
    }
    for (const agent of agents) {
      const g = statusGroup(agent.status)
      counts[g] = (counts[g] ?? 0) + 1
    }
    return counts
  }, [agents])

  /* Filtered + sorted agents */
  const displayAgents = useMemo(() => {
    const filtered = filterText
      ? agents.filter((a) =>
          a.name.toLowerCase().includes(filterText.toLowerCase()),
        )
      : agents
    return sortAgents(filtered)
  }, [agents, filterText])

  /* Build groups for separators — only shown when 6+ agents */
  const showGroups = displayAgents.length >= 6
  const agentGroups = useMemo(() => {
    if (!showGroups) return null
    const groups: { label: string; agents: Agent[] }[] = []
    let currentGroup = ""
    for (const agent of displayAgents) {
      const g = statusGroup(agent.status)
      if (g !== currentGroup) {
        currentGroup = g
        groups.push({
          label: STATUS_GROUP_LABELS[g] ?? g,
          agents: [agent],
        })
      } else {
        groups[groups.length - 1].agents.push(agent)
      }
    }
    return groups
  }, [displayAgents, showGroups])

  const handleAgentClick = useCallback(
    (agentId: string) => {
      if (selectedAgentId === agentId) {
        onSelectAgent(null)
      } else {
        onSelectAgent(agentId)
      }
    },
    [selectedAgentId, onSelectAgent],
  )

  /* Count of active (non-stopped) agents for the fleet pills */
  const hasAnyAgents = agents.length > 0

  return (
    <div className="w-[260px] h-full bg-surface-sunken border-r-[0.5px] border-border-default flex flex-col">
      <div className="flex-1 flex flex-col bg-surface min-h-0">
        {/* ---- Header: label + fleet pills + actions ---- */}
        <div className="px-3 pt-3 pb-1 flex flex-col gap-1.5 shrink-0">
          {/* Top row: "Agents" label + action buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Agents
              </span>

              {/* Fleet health pills — inline with label */}
              {hasAnyAgents && (
                <div className="flex items-center gap-1.5 ml-1">
                  {PILL_CONFIG.map(
                    (pill) =>
                      (statusCounts[pill.key] ?? 0) > 0 && (
                        <span
                          key={pill.key}
                          className={cn(
                            "inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums",
                            pill.text,
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              pill.dot,
                              pill.animate && "animate-breathe text-success",
                            )}
                          />
                          {statusCounts[pill.key]}
                        </span>
                      ),
                  )}
                </div>
              )}
            </div>

            {/* Action buttons: search + add */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setIsSearching((prev) => !prev)}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  isSearching
                    ? "text-accent bg-accent-subtle"
                    : "text-muted hover:text-secondary hover:bg-surface-raised/50",
                )}
                aria-label="Filter agents"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onAddAgent}
                className="p-1 rounded-md text-muted hover:text-accent hover:bg-accent-subtle transition-colors animate-add-glow"
                aria-label="Add agent"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Search input — expandable */}
          {isSearching && (
            <div className="flex items-center gap-1.5 rounded-md border-[0.5px] border-border-default bg-surface-raised/60 focus-within:bg-surface-raised focus-within:border-accent/40 transition-colors px-2 py-1">
              <Search className="h-3 w-3 text-muted shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Filter by name..."
                className="flex-1 bg-transparent border-none outline-none text-xs text-default placeholder:text-muted/60 min-w-0"
              />
              {filterText && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterText("")
                    searchInputRef.current?.focus()
                  }}
                  className="p-0.5 text-muted hover:text-secondary rounded transition-colors shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Thin separator below header */}
        <div className="mx-3 h-px bg-border-subtle shrink-0" />

        {/* ---- Agent list ---- */}
        {displayAgents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
            {agents.length === 0 ? (
              <>
                {/* Empty state: no agents at all */}
                <div className="h-11 w-11 rounded-xl bg-surface-raised/80 border border-border-subtle flex items-center justify-center">
                  <Plus className="h-5 w-5 text-muted/70" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-secondary text-xs font-medium">
                    No agents yet
                  </p>
                  <p className="text-muted/60 text-[11px] leading-relaxed">
                    Launch your first agent to start building
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onAddAgent}
                  className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/90 hover:bg-accent text-on-emphasis text-xs font-medium transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add agent
                </button>
              </>
            ) : (
              /* Empty state: filter has no results */
              <div className="text-center space-y-1">
                <p className="text-muted text-xs">
                  No agents match &ldquo;{filterText}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterText("")
                    searchInputRef.current?.focus()
                  }}
                  className="text-accent text-[11px] hover:underline"
                >
                  Clear filter
                </button>
              </div>
            )}
          </div>
        ) : (
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="flex flex-col pt-1.5 pb-2">
              {/* "All agents" option */}
              <button
                type="button"
                onClick={() => onSelectAgent(null)}
                className={cn(
                  "mx-1.5 rounded-lg transition-all duration-150 text-left px-3 py-2",
                  "border-l-2 border-transparent",
                  selectedAgentId === null
                    ? "bg-surface-raised/80 border-l-accent"
                    : "hover:bg-surface-raised/30",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                  <span
                    className={cn(
                      "text-[13px] font-medium",
                      selectedAgentId === null
                        ? "text-default"
                        : "text-secondary",
                    )}
                  >
                    All agents
                  </span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-muted tabular-nums font-mono">
                    {agents.length}
                  </span>
                </div>
              </button>

              {/* Agents — grouped or flat */}
              {showGroups && agentGroups
                ? agentGroups.map((group, gi) => (
                    <div key={group.label}>
                      {/* Group separator — thin label */}
                      <div
                        className={cn(
                          "flex items-center gap-2 px-4 mt-2",
                          gi > 0 && "roster-separator pt-2",
                        )}
                      >
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted/50">
                          {group.label}
                        </span>
                        <span className="text-[9px] text-muted/30 tabular-nums font-mono">
                          {group.agents.length}
                        </span>
                      </div>
                      {group.agents.map((agent, ai) => (
                        <div
                          key={agent.id}
                          className="animate-roster-item-in"
                          style={{
                            animationDelay: `${(gi * 3 + ai) * 30}ms`,
                          }}
                        >
                          <AgentRosterItem
                            agent={agent}
                            isSelected={selectedAgentId === agent.id}
                            onClick={() => handleAgentClick(agent.id)}
                          />
                        </div>
                      ))}
                    </div>
                  ))
                : displayAgents.map((agent, i) => (
                    <div
                      key={agent.id}
                      className="animate-roster-item-in"
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <AgentRosterItem
                        agent={agent}
                        isSelected={selectedAgentId === agent.id}
                        onClick={() => handleAgentClick(agent.id)}
                      />
                    </div>
                  ))}
            </div>
          </ScrollArea>
        )}

        {/* ---- Bottom bar: user menu ---- */}
        <div className="px-3 py-2 flex items-center shrink-0 border-t border-border-default">
          <UserMenu username={username} email={email} />
        </div>
      </div>
    </div>
  )
}

export { AgentRoster }
export type { AgentRosterProps }
