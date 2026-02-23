"use client"

import { Menu } from "lucide-react"
import { cn, formatCost, friendlyModelName } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ProjectSwitcher } from "@/components/layout/project-switcher"
import { AgentActions } from "@/components/layout/agent-actions"
import type { Agent, Project } from "@/types"

type AgentActionHandlers = {
  onKillAgent: (agentId: string) => void
  onRemoveAgent: (agentId: string) => void
  onRestartAgent: (agentId: string) => void
  onSetAgentMode: (agentId: string, mode: string) => void
  onClearAgentSession: (agentId: string) => void
}

type HeaderProps = {
  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string) => void
  onNewProject?: (name: string) => void
  agents?: Agent[]
  selectedAgentId: string | null
  onToggleSidebar: () => void
  totalCost?: number
  agentActions?: AgentActionHandlers
}

const statusColors: Record<string, string> = {
  running: "text-success",
  idle: "text-info",
  waiting: "text-warning",
  error: "text-danger",
  stopped: "text-muted",
}

function Header({
  projects,
  selectedProjectId,
  onSelectProject,
  onNewProject,
  agents = [],
  selectedAgentId,
  onToggleSidebar,
  totalCost,
  agentActions,
}: HeaderProps) {
  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId) ?? null
    : null

  return (
    <div className="h-12 border-b border-border-default bg-surface-sunken px-4 flex items-center gap-4">
      {/* Left section — sidebar toggle + project switcher */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="p-1.5"
          onClick={onToggleSidebar}
        >
          <Menu className="h-4 w-4" />
        </Button>
        <ProjectSwitcher
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
          onNewProject={onNewProject}
        />
      </div>

      {/* Center section — selected agent indicator */}
      <div className="flex-1 flex items-center justify-center">
        {selectedAgent ? (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-raised/50 text-xs">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                selectedAgent.status === "running" && "bg-success animate-breathe text-success",
                selectedAgent.status === "error" && "bg-danger",
                selectedAgent.status === "idle" && "bg-info",
                selectedAgent.status === "stopped" && "bg-muted/50",
                selectedAgent.status === "waiting" && "bg-warning",
              )}
            />
            <span className="font-medium text-default">
              {selectedAgent.name}
            </span>
            {selectedAgent.model && (
              <>
                <span className="text-muted">&middot;</span>
                <span className="text-muted font-mono">
                  {friendlyModelName(selectedAgent.model)}
                </span>
              </>
            )}
            <span
              className={cn(
                "text-[10px] capitalize",
                statusColors[selectedAgent.status] ?? "text-muted",
              )}
            >
              {selectedAgent.status}
            </span>
          </div>
        ) : agents.length > 0 ? (
          <span className="text-xs text-muted">
            All agents ({agents.length})
          </span>
        ) : null}
      </div>

      {/* Right section — total cost + agent actions */}
      <div className="flex items-center gap-2">
        {totalCost !== undefined && totalCost > 0 && (
          <span className="text-xs text-muted font-mono">
            {formatCost(totalCost)}
          </span>
        )}
        {selectedAgent && agentActions && (
          <AgentActions
            agent={selectedAgent}
            onKill={agentActions.onKillAgent}
            onRemove={agentActions.onRemoveAgent}
            onRestart={agentActions.onRestartAgent}
            onSetMode={agentActions.onSetAgentMode}
            onClearSession={agentActions.onClearAgentSession}
          />
        )}
      </div>
    </div>
  )
}

export { Header }
export type { HeaderProps, AgentActionHandlers }
