"use client"

import { useState } from "react"
import {
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Trash2,
} from "lucide-react"
import type { Agent } from "@/lib/types"
import { TagInput } from "@/components/agent/tag-input"
import {
  useRestartAgent,
  useHardRestartAgent,
  useRemoveAgent,
  useUpdateAgentInstructions,
  useUpdateAgentConfig,
} from "@/lib/graphql/hooks/use-agents"

export interface AgentSettingsPanelProps {
  agent: Agent
}

export function AgentSettingsPanel({ agent }: AgentSettingsPanelProps) {
  const [model, setModel] = useState(agent.model)
  const [instructions, setInstructions] = useState(agent.instructions)
  const [agentTags, setAgentTags] = useState(agent.tags)
  const dirty = model !== agent.model || instructions !== agent.instructions || JSON.stringify(agentTags) !== JSON.stringify(agent.tags)

  const restart = useRestartAgent()
  const hardRestart = useHardRestartAgent()
  const remove = useRemoveAgent()
  const updateInstructions = useUpdateAgentInstructions()
  const updateConfig = useUpdateAgentConfig()

  const handleRestart = () => {
    if (dirty) {
      // Save changes then hard restart
      if (instructions !== agent.instructions) {
        updateInstructions(agent.id, instructions)
      }
      if (model !== agent.model) {
        updateConfig(agent.id, { model })
      }
      hardRestart(agent.id)
    } else {
      restart(agent.id)
    }
  }

  const handleRedeploy = () => {
    hardRestart(agent.id)
  }

  const handleRemove = () => {
    remove(agent.id)
  }

  return (
    <div className="px-3 py-3 space-y-3">
      {/* Model selector */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          Model
        </label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs text-default outline-none focus:border-accent/50 transition-colors"
        >
          <option>Opus 4.6</option>
          <option>Sonnet 4.6</option>
          <option>Haiku 4.5</option>
        </select>
      </div>

      {/* Instructions textarea */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          Instructions
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default outline-none focus:border-accent/50 transition-colors resize-none"
        />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          Tags
        </label>
        <div className="bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 focus-within:border-accent/50 transition-colors">
          <TagInput tags={agentTags} onChange={setAgentTags} placeholder="Add tag..." />
        </div>
      </div>

      {/* MCP Servers */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          MCP Servers
        </label>
        {agent.mcpServers.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {agent.mcpServers.map((server) => (
              <span
                key={server}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-sunken/60 border border-border-subtle text-[11px] font-mono text-secondary"
              >
                {server}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-muted/50 font-mono">none configured</span>
        )}
      </div>

      {/* Info line */}
      <div className="text-[10px] text-muted font-mono">
        Runtime: {agent.runtime} · Workspace: {agent.workspacePath}
      </div>

      {/* Restart banner */}
      {dirty && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-warning-subtle/30 border border-warning/20">
          <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
          <span className="text-[11px] text-warning">Changes require restart</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleRestart}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-accent/30 text-[11px] text-accent font-medium hover:bg-accent/10 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Restart
        </button>
        <button
          type="button"
          onClick={handleRedeploy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-default text-[11px] text-secondary font-medium hover:bg-surface-sunken/40 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Redeploy
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={handleRemove}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-danger/30 text-[11px] text-danger font-medium hover:bg-danger-subtle/40 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
          Remove
        </button>
      </div>
    </div>
  )
}
