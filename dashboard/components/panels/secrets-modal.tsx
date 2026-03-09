"use client"

import { useState, useEffect, useMemo } from "react"
import { useParams } from "next/navigation"
import {
  KeyRound,
  Trash2,
  X,
  Check,
  AlertTriangle,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAgents } from "@/lib/graphql/hooks/use-agents"
import {
  useAccountSecrets,
  useSetAccountSecret,
  useDeleteAccountSecret,
  useSecrets,
  useSetSecret,
  useDeleteSecret,
} from "@/lib/graphql/hooks/use-secrets"
import { useProviderStatus } from "@/lib/graphql/hooks/use-models"

type SecretEntry = {
  id: string
  key: string
  createdAt: string
  updatedAt: string
}

type MergedSecret = SecretEntry & {
  level: "account" | "project"
  overridden?: boolean // account secret shadowed by project secret
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function SecretsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: agentsData } = useAgents()
  const agents = agentsData?.agents ?? []
  const { providers } = useProviderStatus(projectId ?? "")

  const { data: accountData } = useAccountSecrets(!open)
  const accountSecrets = accountData?.accountSecrets ?? []

  const { data: projectData } = useSecrets(projectId ?? "", !open || !projectId)
  const projectSecrets = projectData?.projectSecrets ?? []

  const setAccountSecret = useSetAccountSecret()
  const deleteAccountSecret = useDeleteAccountSecret()
  const setSecret = useSetSecret(projectId ?? "")
  const deleteSecret = useDeleteSecret(projectId ?? "")

  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [newLevel, setNewLevel] = useState<"account" | "project">("account")
  const [dirty, setDirty] = useState(false)
  const [restarted, setRestarted] = useState(false)

  // Merge account + project secrets into a single list
  const mergedSecrets = useMemo(() => {
    const projectKeySet = new Set(projectSecrets.map((s) => s.key))
    const merged: MergedSecret[] = []

    // Account secrets first (may be overridden)
    for (const s of accountSecrets) {
      merged.push({
        ...s,
        level: "account",
        overridden: projectKeySet.has(s.key),
      })
    }

    // Project secrets
    for (const s of projectSecrets) {
      merged.push({ ...s, level: "project" })
    }

    // Sort: non-overridden first, then alphabetical
    merged.sort((a, b) => {
      if (a.overridden && !b.overridden) return 1
      if (!a.overridden && b.overridden) return -1
      return a.key.localeCompare(b.key)
    })

    return merged
  }, [accountSecrets, projectSecrets])

  // Detect credential type from value prefix (Anthropic keys only)
  const credentialHint = useMemo(() => {
    if (newKey !== "ANTHROPIC_API_KEY" || !newValue.trim()) return null
    if (newValue.startsWith("sk-ant-oat")) return "oauth" as const
    if (newValue.startsWith("sk-ant-")) return "api_key" as const
    return null
  }, [newKey, newValue])

  // Escape handler
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setDirty(false)
      setRestarted(false)
      setNewKey("")
      setNewValue("")
      setNewLevel("account")
    }
  }, [open])

  if (!open) return null

  const activeAgents = agents.filter((a) => a.lifecycleStatus === "running" || a.lifecycleStatus === "idle" || a.lifecycleStatus === "deploying")
  const needsRestart = dirty && !restarted

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return
    const key = newKey.trim().toUpperCase()
    const value = newValue.trim()

    if (newLevel === "account") {
      await setAccountSecret(key, value)
    } else {
      if (!projectId) return
      await setSecret(key, value)
    }

    setNewKey("")
    setNewValue("")
    setDirty(true)
    setRestarted(false)
  }

  const handleDelete = async (secret: MergedSecret) => {
    if (secret.level === "account") {
      await deleteAccountSecret(secret.key)
    } else {
      if (!projectId) return
      await deleteSecret(secret.key)
    }
    setDirty(true)
    setRestarted(false)
  }

  const handleOverride = (key: string) => {
    setNewKey(key)
    setNewLevel("project")
    // Focus the value input
  }

  const handleRestart = () => {
    setRestarted(true)
  }

  return (
    <div
      className="fixed inset-0 z-(--z-overlay) flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-surface-backdrop backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="secrets-title"
        tabIndex={-1}
        className="relative w-full max-w-lg mx-4 rounded-xl border border-border-default bg-surface-raised shadow-lg overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted" />
              <h2 id="secrets-title" className="text-sm font-semibold text-default">Secrets</h2>
            </div>
            <p className="text-[11px] text-muted mt-0.5 ml-6">
              Environment variables injected into agent containers
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-sunken/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Provider keys */}
        {providers.length > 0 && (
          <div className="px-5 pb-3 border-b border-border-subtle">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
              Provider Keys
            </p>
            <div className="flex flex-wrap gap-1.5">
              {providers.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  disabled={p.configured}
                  onClick={() => {
                    if (!p.configured) setNewKey(p.keyName)
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
                    p.configured
                      ? "bg-success-subtle/30 text-success border border-success/20 cursor-default"
                      : "bg-surface-sunken/60 text-secondary border border-border-default hover:border-accent/50 hover:text-accent",
                  )}
                >
                  {p.configured && <Check className="h-2.5 w-2.5" />}
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Secrets list */}
        <div className="px-5 max-h-[320px] overflow-y-auto">
          {mergedSecrets.length === 0 ? (
            <div className="py-8 text-center">
              <KeyRound className="h-8 w-8 text-muted/30 mx-auto mb-2" />
              <p className="text-xs text-muted">No secrets configured</p>
            </div>
          ) : (
            <div className="space-y-px">
              {mergedSecrets.map((secret) => (
                <div
                  key={`${secret.level}-${secret.id}`}
                  className={cn(
                    "group flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-b-0",
                    secret.overridden && "opacity-40",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium text-default truncate">
                        {secret.key}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium tracking-wide shrink-0",
                          secret.level === "account"
                            ? "bg-accent/8 text-accent/70 border border-accent/15"
                            : "bg-surface-sunken text-muted border border-border-default",
                        )}
                      >
                        {secret.level}
                      </span>
                      {secret.overridden && (
                        <span className="text-[9px] text-muted/50 italic shrink-0">
                          overridden
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted/50 font-mono">
                      {timeAgo(secret.updatedAt)}
                    </span>
                  </div>

                  <span className="text-[11px] font-mono text-muted/40">
                    {"●".repeat(12)}
                  </span>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    {secret.level === "account" && !secret.overridden && (
                      <button
                        type="button"
                        onClick={() => handleOverride(secret.key)}
                        className="p-1 rounded text-muted hover:text-accent transition-colors"
                        title="Override at project level"
                      >
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(secret)}
                      className="p-1 rounded text-muted hover:text-danger transition-colors"
                      title={`Delete ${secret.level} secret`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add secret form */}
        <div className="px-5 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              placeholder="KEY_NAME"
              className="flex-1 min-w-0 bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
            />
            <input
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              className="flex-1 min-w-0 bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newKey.trim() || !newValue.trim()}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0",
                newKey.trim() && newValue.trim()
                  ? "bg-accent text-on-emphasis hover:bg-accent-hover"
                  : "bg-surface-sunken text-muted cursor-not-allowed",
              )}
            >
              Add
            </button>
          </div>

          {/* Level toggle + credential detection */}
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1 bg-surface-sunken/40 rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setNewLevel("account")}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                  newLevel === "account"
                    ? "bg-surface-raised text-default shadow-sm"
                    : "text-muted hover:text-secondary",
                )}
              >
                account
              </button>
              <button
                type="button"
                onClick={() => setNewLevel("project")}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                  newLevel === "project"
                    ? "bg-surface-raised text-default shadow-sm"
                    : "text-muted hover:text-secondary",
                )}
              >
                project
              </button>
            </div>

            {credentialHint && (
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide",
                    credentialHint === "oauth"
                      ? "bg-accent/10 text-accent border border-accent/20"
                      : "bg-surface-sunken text-muted border border-border-default",
                  )}
                >
                  {credentialHint === "oauth" ? "OAuth Token" : "API Key"}
                </span>
                {credentialHint === "oauth" && (
                  <span className="text-[10px] text-muted/50">
                    via <span className="font-mono">claude setup-token</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Restart banner */}
        {needsRestart && activeAgents.length > 0 && (
          <div className="px-5 py-3 border-t border-warning/20 bg-warning-subtle/30 flex items-center gap-3">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-xs text-warning flex-1">
              {activeAgents.length} agent{activeAgents.length !== 1 ? "s" : ""} need restart to pick up changes
            </span>
            <button
              type="button"
              onClick={handleRestart}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-warning/20 text-warning text-xs font-medium hover:bg-warning/30 transition-colors shrink-0"
            >
              <RefreshCw className="h-3 w-3" />
              Restart All
            </button>
          </div>
        )}

        {/* Restarted confirmation */}
        {restarted && (
          <div className="px-5 py-3 border-t border-success/20 bg-success-subtle/30 flex items-center gap-3">
            <Check className="h-3.5 w-3.5 text-success shrink-0" />
            <span className="text-xs text-success">
              {activeAgents.length} agent{activeAgents.length !== 1 ? "s" : ""} restarting with updated environment
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
