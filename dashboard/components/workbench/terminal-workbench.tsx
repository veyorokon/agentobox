"use client"

import { useState, useMemo, Fragment } from "react"
import { Group, Panel, Separator } from "react-resizable-panels"
import { TerminalPane, type PaneAgent } from "@/components/workbench/terminal-pane"
import { normalizeRequestedAgentIds } from "@/components/workbench/workbench-layout"

export type { PaneAgent as WorkbenchAgent }

/**
 * TerminalWorkbench — panel-based layout for arbitrary terminal count.
 *
 * Each agent gets a resizable panel with its own terminal pane.
 * Panels resize independently; ResizeObserver inside each TerminalPane
 * handles the fit chain. No floating windows, no z-ordering.
 */
export function TerminalWorkbench({
  agents,
  initialAgentIds,
}: {
  agents: PaneAgent[]
  initialAgentIds: string[]
}) {
  const [activeAgentId, setActiveAgentId] = useState("")

  // Filter to requested agents, or show all if none specified
  const visibleAgents = useMemo(() => {
    if (initialAgentIds.length === 0) return agents
    const requested = new Set(initialAgentIds)
    const filtered = agents.filter(a => requested.has(a.id))
    return filtered.length > 0 ? filtered : agents
  }, [agents, initialAgentIds])

  if (visibleAgents.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#1b1f26] text-[#6b7280]">
        <span className="font-mono text-sm">no agents available</span>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-[#1b1f26]">
      <Group orientation="horizontal" className="h-full">
        {visibleAgents.map((agent, i) => (
          <Fragment key={agent.id}>
            {i > 0 && (
              <Separator className="w-[3px] bg-[#2a2e37] hover:bg-[#4a5060] active:bg-[#6b7280] transition-colors" />
            )}
            <Panel minSize={15} defaultSize={100 / visibleAgents.length}>
              <TerminalPane
                agent={agent}
                active={activeAgentId === agent.id}
                onActivate={() => setActiveAgentId(agent.id)}
              />
            </Panel>
          </Fragment>
        ))}
      </Group>
    </div>
  )
}
