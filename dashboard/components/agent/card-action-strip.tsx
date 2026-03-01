"use client"

import { useState } from "react"
import { Shield, FileText, AlertTriangle, RotateCcw, RefreshCw } from "lucide-react"
import type { CardActionItem } from "@/lib/types"
import { ActionButtonPair } from "@/components/feed/action-button-pair"
import { StepperNav } from "@/components/shared/stepper-nav"

interface CardActionStripProps {
  items: CardActionItem[]
  onResolvePermission: (id: string, verdict: string, alwaysAllow?: boolean) => void
  onResolvePlan: (id: string, verdict: string) => void
  onRestart?: () => void
  onRedeploy?: () => void
}

export function CardActionStrip({
  items,
  onResolvePermission,
  onResolvePlan,
  onRestart,
  onRedeploy,
}: CardActionStripProps) {
  const [stepIdx, setStepIdx] = useState(0)

  if (items.length === 0) return null

  const clamped = Math.min(stepIdx, items.length - 1)
  const current = items[clamped]

  return (
    <div className="border-t border-warning/20 bg-warning-subtle/10 px-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        {current.kind === "permission" && (
          <>
            <Shield className="h-3 w-3 text-warning shrink-0" />
            <span className="text-[11px] text-warning font-medium truncate flex-1 min-w-0">
              {current.feedItem.command}
            </span>
            <div className="shrink-0">
              <ActionButtonPair
                compact
                onPositive={() => onResolvePermission(current.feedItem.id, "allowed")}
                onNegative={() => onResolvePermission(current.feedItem.id, "denied")}
                positiveLabel="Allow"
                negativeLabel="Deny"
                onTertiary={() => onResolvePermission(current.feedItem.id, "allowed", true)}
                tertiaryLabel="Always"
              />
            </div>
          </>
        )}

        {current.kind === "plan" && (
          <>
            <FileText className="h-3 w-3 text-warning shrink-0" />
            <span className="text-[11px] text-warning font-medium truncate flex-1 min-w-0">
              Plan: {current.feedItem.title}
            </span>
            <div className="shrink-0">
              <ActionButtonPair
                compact
                onPositive={() => onResolvePlan(current.feedItem.id, "approved")}
                onNegative={() => onResolvePlan(current.feedItem.id, "rejected")}
                positiveLabel="Approve"
                negativeLabel="Reject"
              />
            </div>
          </>
        )}

        {current.kind === "config-dirty" && (
          <>
            <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
            <span className="text-[11px] text-warning font-medium truncate flex-1 min-w-0">
              Settings changed
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {onRestart && (
                <button
                  type="button"
                  onClick={onRestart}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent/10 transition-colors"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  Restart
                </button>
              )}
              {onRedeploy && (
                <button
                  type="button"
                  onClick={onRedeploy}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-secondary border border-border-default hover:bg-surface-sunken/40 transition-colors"
                >
                  <RefreshCw className="h-2.5 w-2.5" />
                  Redeploy
                </button>
              )}
            </div>
          </>
        )}

        <StepperNav
          current={clamped}
          total={items.length}
          onPrev={() => setStepIdx(clamped - 1)}
          onNext={() => setStepIdx(clamped + 1)}
        />
      </div>
    </div>
  )
}
