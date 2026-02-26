"use client"

import { Check, X, Shield, AlertTriangle } from "lucide-react"
import { AgentAvatar, ChatAvatar } from "@/components/agent/avatar"
import { useTeamStore } from "@/lib/stores/team"

export interface PermissionCardProps {
  agent: string
  command: string
  risk?: string
  permStatus: "pending" | "allowed" | "denied"
  feedIndex: number
}

/** Permission request card */
export function PermissionCard({
  agent,
  command,
  risk,
  permStatus,
  feedIndex,
}: PermissionCardProps) {
  const resolvePermission = useTeamStore(s => s.resolvePermission)

  if (permStatus === "allowed") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-success">
          Allowed: <code className="bg-surface-sunken/60 px-1 rounded">{command}</code> <Check className="inline h-3 w-3" strokeWidth={2.5} />
        </span>
      </div>
    )
  }

  if (permStatus === "denied") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-muted">
          Denied: <code className="bg-surface-sunken/60 px-1 rounded">{command}</code> <X className="inline h-3 w-3" strokeWidth={2.5} />
        </span>
      </div>
    )
  }

  return (
    <div className="flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-info font-mono mb-0.5">
          <Shield className="inline h-3 w-3 mr-1" />
          {agent} · Requesting permission
        </div>
        <div className="rounded-lg border border-info/20 bg-surface-raised/60 p-3 max-w-lg">
          <div className="rounded-md bg-surface-sunken/60 border border-border-subtle px-3 py-2 mb-2">
            <code className="text-xs font-mono text-default">{command}</code>
          </div>
          {risk && (
            <div className="flex items-center gap-1.5 mb-3">
              <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
              <span className="text-[11px] text-warning">{risk}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => resolvePermission(feedIndex, "allowed")}
              className="px-3 py-1.5 rounded-md border border-success/30 text-xs font-medium text-success hover:bg-success-subtle/40 transition-colors"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => resolvePermission(feedIndex, "allowed")}
              className="px-3 py-1.5 rounded-md border border-border-default text-xs font-medium text-secondary hover:bg-surface-sunken/40 transition-colors"
            >
              Allow always
            </button>
            <button
              type="button"
              onClick={() => resolvePermission(feedIndex, "denied")}
              className="px-3 py-1.5 rounded-md border border-danger/30 text-xs font-medium text-danger hover:bg-danger-subtle/40 transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
