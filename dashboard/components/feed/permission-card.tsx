"use client"

import { AlertTriangle, Shield } from "lucide-react"
import { AgentTag } from "@/components/agent/avatar"
import { CompactStatusLine } from "@/components/feed/compact-status-line"
import { ActionButtonPair } from "@/components/feed/action-button-pair"
import { useResolvePermission } from "@/lib/graphql/hooks/use-feed"

export interface PermissionCardProps {
  agent: string
  command: string
  risk?: string
  permStatus: "pending" | "allowed" | "denied"
  feedItemId: string
}

/** Permission request card */
export function PermissionCard({
  agent,
  command,
  risk,
  permStatus,
  feedItemId,
}: PermissionCardProps) {
  const resolvePermission = useResolvePermission()

  if (permStatus === "allowed") {
    return (
      <CompactStatusLine agent={agent} color="text-success">
        Allowed: <code className="bg-surface-sunken/60 px-1 rounded">{command}</code>
      </CompactStatusLine>
    )
  }

  if (permStatus === "denied") {
    return (
      <CompactStatusLine agent={agent}>
        Denied: <code className="bg-surface-sunken/60 px-1 rounded">{command}</code>
      </CompactStatusLine>
    )
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-info font-mono mb-0.5">
        <Shield className="inline h-3 w-3" />
        <AgentTag name={agent} />
        <span className="text-muted/50">· Requesting permission</span>
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
        <ActionButtonPair
          onPositive={() => resolvePermission(feedItemId, "allowed")}
          onNegative={() => resolvePermission(feedItemId, "denied")}
        />
      </div>
    </div>
  )
}
