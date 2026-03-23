"use client"

import { useState, useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react"
import { useParams } from "next/navigation"
import {
  Trash2,
  X,
  Plus,
  Search,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Agent, ConfigSyncState } from "@/lib/types"
import { TagInput } from "@/components/shared/tag-input"
import { Collapsible } from "@/components/ui/collapsible"
import {
  useRemoveAgent,
  useUpdateAgentInstructions,
  useUpdateAgentConfig,
} from "@/lib/graphql/hooks/use-agents"
import { useAvailableModels, useProviderStatus } from "@/lib/graphql/hooks/use-models"
import { useMcpSearch } from "@/lib/graphql/hooks/use-mcp-search"
import { toast } from "@/lib/toast"

/* ------------------------------------------------------------------ */
/*  Pure helpers — exported for testing                                */
/* ------------------------------------------------------------------ */

export type ConfigFields = {
  model: string
  instructions: string
  tags: string[]
  mcpNames: string[]
}

/** Single extraction point for all three comparison surfaces. */
export function extractConfigFields(source: {
  model: string
  instructions: string
  tags: string[]
  mcpServers?: string[]
  mcpNames?: string[]
}): ConfigFields {
  return {
    model: source.model,
    instructions: source.instructions,
    tags: source.tags,
    mcpNames: source.mcpServers ?? source.mcpNames ?? [],
  }
}

function fieldsEqual(a: ConfigFields, b: ConfigFields): boolean {
  return (
    a.model === b.model &&
    a.instructions === b.instructions &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
    JSON.stringify(a.mcpNames) === JSON.stringify(b.mcpNames)
  )
}

/**
 * Derive next sync status from three-way comparison.
 *
 * - local: current form values
 * - lastSubmittedConfig: snapshot captured at save time (null when not saving)
 * - server: latest agent props from Apollo cache
 * - current: current sync status
 */
export function deriveConfigSyncStatus(
  local: ConfigFields,
  lastSubmittedConfig: ConfigFields | null,
  server: ConfigFields,
  current: ConfigSyncState["status"],
): ConfigSyncState["status"] {
  const localMatchesServer = fieldsEqual(local, server)

  if (current === "saving") {
    // Refetch hasnt landed until server matches what we submitted
    if (!lastSubmittedConfig || !fieldsEqual(server, lastSubmittedConfig)) return "saving"
    // Refetch landed — check if user edited during save
    return localMatchesServer ? "in-sync" : "unsaved"
  }

  return localMatchesServer ? "in-sync" : "unsaved"
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface SettingsPanelHandle {
  saveChanges: () => void
}

export interface AgentSettingsPanelProps {
  agent: Agent
  onSyncStateChange?: (state: ConfigSyncState) => void
}

export const AgentSettingsPanel = forwardRef<SettingsPanelHandle, AgentSettingsPanelProps>(function AgentSettingsPanel({ agent, onSyncStateChange }, ref) {
  const { projectId } = useParams<{ projectId: string }>()
  const { models } = useAvailableModels()
  const { providers } = useProviderStatus(projectId ?? "")

  const [model, setModel] = useState(agent.model)
  const [instructions, setInstructions] = useState(agent.instructions)
  const [agentTags, setAgentTags] = useState(agent.tags)
  // MCP state — registry names (resolved by backend) + custom configs (command+args)
  const [mcpRegistryNames, setMcpRegistryNames] = useState<string[]>(agent.mcpServers)
  const [mcpCustomServers, setMcpCustomServers] = useState<Record<string, { command: string; args: string[] }>>({})

  // MCP search state
  const [showMcpSearch, setShowMcpSearch] = useState(false)
  const { query: mcpQuery, setQuery: setMcpQuery, results: mcpResults, loading: mcpSearchLoading } = useMcpSearch()

  // Custom MCP state
  const [showCustomMcp, setShowCustomMcp] = useState(false)
  const [customName, setCustomName] = useState("")
  const [customCommand, setCustomCommand] = useState("")
  const [customArgs, setCustomArgs] = useState("")

  // Combined display list: registry names + custom server names
  const allMcpNames = [...mcpRegistryNames, ...Object.keys(mcpCustomServers)]

  // --- Config sync state machine ---
  const [syncState, setSyncState] = useState<ConfigSyncState>({ status: "in-sync" })
  const lastSubmittedConfigRef = useRef<ConfigFields | null>(null)

  const localFields: ConfigFields = { model, instructions, tags: agentTags, mcpNames: allMcpNames }
  const serverFields = extractConfigFields(agent)

  useEffect(() => {
    const next = deriveConfigSyncStatus(
      localFields,
      lastSubmittedConfigRef.current,
      serverFields,
      syncState.status,
    )
    if (next !== syncState.status) {
      const nextState: ConfigSyncState = next === "save-error"
        ? { status: "save-error", message: "" }
        : { status: next }
      // Clear submitted snapshot when leaving saving state
      if (syncState.status === "saving" && next !== "saving") {
        lastSubmittedConfigRef.current = null
      }
      setSyncState(nextState)
    }
  })

  useEffect(() => {
    onSyncStateChange?.(syncState)
  }, [syncState, onSyncStateChange])

  const remove = useRemoveAgent()
  const updateInstructions = useUpdateAgentInstructions()
  const updateConfig = useUpdateAgentConfig()

  const isDeploying = agent.lifecycleStatus === "deploying"

  const handleSaveChanges = useCallback(async () => {
    if (syncState.status === "saving") return
    if (syncState.status === "in-sync") return

    lastSubmittedConfigRef.current = extractConfigFields({
      model, instructions, tags: agentTags, mcpServers: allMcpNames,
    })
    setSyncState({ status: "saving" })

    try {
      if (instructions !== agent.instructions) {
        await updateInstructions(agent.id, instructions)
      }
      const configDelta: { model?: string; tags?: string[]; mcpRegistryNames?: string[]; mcpCustomServers?: Record<string, { command: string; args: string[] }> } = {}
      if (model !== agent.model) configDelta.model = model
      if (JSON.stringify(agentTags) !== JSON.stringify(agent.tags)) configDelta.tags = agentTags
      if (JSON.stringify(allMcpNames) !== JSON.stringify(agent.mcpServers)) {
        configDelta.mcpRegistryNames = mcpRegistryNames
        if (Object.keys(mcpCustomServers).length > 0) {
          configDelta.mcpCustomServers = mcpCustomServers
        }
      }
      if (Object.keys(configDelta).length > 0) {
        await updateConfig(agent.id, configDelta)
      }
      toast.success("Changes saved")
    } catch (err: any) {
      lastSubmittedConfigRef.current = null
      setSyncState({ status: "save-error", message: err.message || "Failed to save" })
      toast.error(err.message || "Failed to save")
    }
  }, [syncState.status, agent.id, agent.instructions, agent.model, agent.tags, agent.mcpServers, instructions, model, agentTags, allMcpNames, mcpRegistryNames, mcpCustomServers, updateInstructions, updateConfig])

  useImperativeHandle(ref, () => ({
    saveChanges: handleSaveChanges,
  }), [handleSaveChanges])

  const addMcp = useCallback((name: string) => {
    if (!mcpRegistryNames.includes(name)) {
      setMcpRegistryNames(prev => [...prev, name])
    }
    setShowMcpSearch(false)
    setMcpQuery("")
  }, [mcpRegistryNames, setMcpQuery])

  const removeMcp = useCallback((name: string) => {
    // Remove from whichever list it belongs to
    setMcpRegistryNames(prev => prev.filter(s => s !== name))
    setMcpCustomServers(prev => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }, [])

  const addCustomMcp = useCallback(() => {
    const name = customName.trim()
    if (!name) return
    const args = customArgs.trim() ? customArgs.trim().split(/\s+/) : []
    setMcpCustomServers(prev => ({
      ...prev,
      [name]: { command: customCommand.trim() || "npx", args },
    }))
    setCustomName("")
    setCustomCommand("")
    setCustomArgs("")
    setShowCustomMcp(false)
  }, [customName, customCommand, customArgs])

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
          {Object.entries(
            models.reduce<Record<string, typeof models>>((acc, m) => {
              ;(acc[m.provider] ??= []).push(m)
              return acc
            }, {})
          ).map(([provider, group]) => (
            <optgroup key={provider} label={provider}>
              {group.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {(() => {
          const selected = models.find((m) => m.value === model)
          const provider = selected && providers.find((p) => p.slug === selected.provider)
          if (provider && !provider.configured) {
            return (
              <p className="text-[10px] text-warning mt-1">
                Requires {provider.keyName} — add in Secrets
              </p>
            )
          }
          return null
        })()}
        <p className="text-[9px] text-muted/40 mt-0.5">Saved to backend — runtime picks this up when supported</p>
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
        <p className="text-[9px] text-muted/40 mt-0.5">Saved to backend — takes effect on next task</p>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          Tags
        </label>
        <div className="bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 focus-within:border-accent/50 transition-colors">
          <TagInput tags={agentTags} onChange={setAgentTags} placeholder="Add tag..." />
        </div>
        <p className="text-[9px] text-muted/40 mt-0.5">Saved to backend</p>
      </div>

      {/* MCP Servers — interactive */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          MCP Servers
        </label>

        {/* Current MCPs as removable pills */}
        {allMcpNames.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {allMcpNames.map((server) => (
              <span
                key={server}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-sunken/60 border border-border-subtle text-[11px] font-mono text-secondary group"
              >
                {server}
                <button
                  type="button"
                  onClick={() => removeMcp(server)}
                  className="text-muted/40 hover:text-danger transition-colors"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted/50 font-mono mb-2">none configured</p>
        )}

        {/* Add MCP button + search */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowMcpSearch(!showMcpSearch)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
              showMcpSearch
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
            )}
          >
            <Plus className="h-3 w-3" />
            Add from Registry
          </button>

          <Collapsible open={showMcpSearch}>
            <div className="rounded-md border border-border-default bg-surface-sunken/20 overflow-hidden">
              <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-subtle">
                <Search className="h-3 w-3 text-muted/50 shrink-0" />
                <input
                  type="text"
                  value={mcpQuery}
                  onChange={(e) => setMcpQuery(e.target.value)}
                  placeholder="Search MCP servers..."
                  className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
                />
              </div>
              <div className="max-h-40 overflow-y-auto">
                {mcpSearchLoading && (
                  <div className="px-2.5 py-2 text-[11px] text-muted/50">Searching...</div>
                )}
                {!mcpSearchLoading && mcpQuery && mcpResults.length === 0 && (
                  <div className="px-2.5 py-2 text-[11px] text-muted/50">No results</div>
                )}
                {mcpResults.map((server) => {
                  const alreadyAdded = allMcpNames.includes(server.name)
                  const pkgBadge = server.packages[0]?.registryType
                  return (
                    <button
                      key={server.name}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => addMcp(server.name)}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 border-b border-border-subtle last:border-b-0 transition-colors",
                        alreadyAdded
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-surface-raised/40",
                      )}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-mono text-default truncate flex-1 min-w-0">
                          {server.name}
                        </span>
                        {pkgBadge && (
                          <span className="px-1 py-px rounded text-[9px] font-mono text-muted bg-surface-sunken/60 border border-border-subtle shrink-0">
                            {pkgBadge}
                          </span>
                        )}
                        {server.hasRemote && (
                          <span className="px-1 py-px rounded text-[9px] font-mono text-info/70 bg-info/8 border border-info/15 shrink-0">
                            remote
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted/60 truncate mt-0.5">
                        {server.description}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          </Collapsible>

          {/* Custom MCP */}
          <button
            type="button"
            onClick={() => setShowCustomMcp(!showCustomMcp)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
              showCustomMcp
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
            )}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", showCustomMcp && "rotate-90")} />
            Custom MCP
          </button>

          <Collapsible open={showCustomMcp}>
            <div className="space-y-1.5 rounded-md border border-border-default bg-surface-sunken/20 p-2">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Server name..."
                className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2 py-1 text-[11px] font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
              />
              <input
                type="text"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder="Command (e.g. npx)..."
                className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2 py-1 text-[11px] font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
              />
              <input
                type="text"
                value={customArgs}
                onChange={(e) => setCustomArgs(e.target.value)}
                placeholder="Args (e.g. @playwright/mcp@latest)..."
                className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2 py-1 text-[11px] font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!customName.trim()}
                  onClick={addCustomMcp}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                    customName.trim()
                      ? "bg-accent text-on-emphasis hover:bg-accent-hover"
                      : "bg-surface-sunken text-muted cursor-not-allowed",
                  )}
                >
                  Add
                </button>
              </div>
            </div>
          </Collapsible>
        </div>
        <p className="text-[9px] text-muted/40 mt-0.5">Saved to backend — runtime picks this up when supported</p>
      </div>

      {/* Info line */}
      <div className="text-[10px] text-muted font-mono">
        Runtime: {agent.runtime} · Workspace: {agent.workspacePath}
      </div>

      {/* Remove button -- destructive, stays in settings body */}
      <div className="flex items-center gap-2 pt-1">
        <span className="flex-1" />
        <button
          type="button"
          disabled={isDeploying}
          onClick={handleRemove}
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-medium transition-colors",
            isDeploying
              ? "border-border-subtle text-muted cursor-not-allowed"
              : "border-danger/30 text-danger hover:bg-danger-subtle/40",
          )}
        >
          <Trash2 className="h-3 w-3" />
          Remove
        </button>
      </div>
    </div>
  )
})
