"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { useQuery, useMutation } from "@apollo/client"
import {
  KeyRound,
  Trash2,
  X,
  Check,
  AlertTriangle,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAgents } from "@/lib/graphql/hooks/use-agents"
import { GET_PROJECT_SECRETS } from "@/lib/graphql/queries/secrets"
import { SET_SECRET, DELETE_SECRET } from "@/lib/graphql/mutations/secrets"

type SecretEntry = {
  id: string
  key: string
  createdAt: string
  updatedAt: string
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

  const { data } = useQuery<{ projectSecrets: SecretEntry[] }>(GET_PROJECT_SECRETS, {
    variables: { projectId },
    skip: !open || !projectId,
    fetchPolicy: "cache-and-network",
  })
  const secrets = data?.projectSecrets ?? []

  const [setSecret] = useMutation(SET_SECRET, {
    refetchQueries: [{ query: GET_PROJECT_SECRETS, variables: { projectId } }],
  })
  const [deleteSecret] = useMutation(DELETE_SECRET, {
    refetchQueries: [{ query: GET_PROJECT_SECRETS, variables: { projectId } }],
  })

  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [dirty, setDirty] = useState(false)
  const [restarted, setRestarted] = useState(false)

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
    }
  }, [open])

  if (!open) return null

  const activeAgents = agents.filter((a) => a.lifecycleStatus === "running" || a.lifecycleStatus === "idle" || a.lifecycleStatus === "deploying")
  const needsRestart = dirty && !restarted

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim() || !projectId) return
    await setSecret({
      variables: { input: { projectId, key: newKey.trim().toUpperCase(), value: newValue.trim() } },
    })
    setNewKey("")
    setNewValue("")
    setDirty(true)
    setRestarted(false)
  }

  const handleDelete = async (key: string) => {
    if (!projectId) return
    await deleteSecret({ variables: { projectId, key } })
    setDirty(true)
    setRestarted(false)
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
              <h2 id="secrets-title" className="text-sm font-semibold text-default">Project Secrets</h2>
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

        {/* Secrets list */}
        <div className="px-5 max-h-[320px] overflow-y-auto">
          {secrets.length === 0 ? (
            <div className="py-8 text-center">
              <KeyRound className="h-8 w-8 text-muted/30 mx-auto mb-2" />
              <p className="text-xs text-muted">No secrets configured</p>
            </div>
          ) : (
            <div className="space-y-px">
              {secrets.map((secret) => (
                <div
                  key={secret.id}
                  className="group flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono font-medium text-default block truncate">
                      {secret.key}
                    </span>
                    <span className="text-[10px] text-muted/50 font-mono">
                      {timeAgo(secret.updatedAt)}
                    </span>
                  </div>

                  <span className="text-[11px] font-mono text-muted/40">
                    {"●".repeat(12)}
                  </span>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleDelete(secret.key)}
                      className="p-1 rounded text-muted hover:text-danger transition-colors"
                      title="Delete"
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
