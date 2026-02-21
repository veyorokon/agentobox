"use client"

import { Menu } from "lucide-react"
import { cn, formatCost } from "@/lib/utils"
import { formatModelName } from "@/lib/format"
import { Button } from "@/components/ui/button"
import type { Agent } from "@/types"

type HeaderProps = {
  projectName?: string
  agents?: Agent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
  onToggleSidebar: () => void
  totalCost?: number
}

const statusColors: Record<string, string> = {
  running: "bg-success-000",
  waiting: "bg-warning-000",
  error: "bg-danger-000",
  stopped: "bg-text-400",
}

function Header({
  projectName,
  agents = [],
  selectedAgentId,
  onSelectAgent,
  onToggleSidebar,
  totalCost,
}: HeaderProps) {
  return (
    <div className="h-12 border-b border-border-300 bg-bg-200 px-4 flex items-center gap-4">
      {/* Left section */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="p-1.5"
          onClick={onToggleSidebar}
        >
          <Menu className="h-4 w-4" />
        </Button>
        {projectName && (
          <span className="text-sm font-medium text-text-000">
            {projectName}
          </span>
        )}
      </div>

      {/* Center section — agent chips */}
      <div className="flex-1 flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => onSelectAgent(null)}
          className={cn(
            "px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors",
            selectedAgentId === null
              ? "bg-bg-000 text-text-000"
              : "text-text-300 hover:bg-bg-000/50",
          )}
        >
          All
        </button>
        {agents.map((agent) => {
          const isSelected = selectedAgentId === agent.id
          const cost = parseFloat(agent.sessionCostUsd) || 0
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelectAgent(agent.id)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors inline-flex items-center gap-1.5",
                isSelected
                  ? "bg-bg-000 text-text-000"
                  : "text-text-300 hover:bg-bg-000/50",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  statusColors[agent.status] ?? "bg-text-400",
                )}
              />
              {agent.name}
              {isSelected && agent.model && (
                <span className="text-[10px] text-text-500 font-mono">
                  {formatModelName(agent.model)}
                </span>
              )}
              {isSelected && cost > 0 && (
                <>
                  <span className="text-[10px] text-text-500">&middot;</span>
                  <span className="text-[10px] text-text-500 font-mono">
                    {formatCost(cost)}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* Right section */}
      <div className="flex items-center">
        {totalCost !== undefined && (
          <span className="text-xs text-text-400">
            {formatCost(totalCost)}
          </span>
        )}
      </div>
    </div>
  )
}

export { Header }
export type { HeaderProps }
