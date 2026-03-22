"use client"

import { useState } from "react"
import { Shield, FileText, AlertTriangle, BookOpen, X, CheckCircle2 } from "lucide-react"
import type { CardActionItem } from "@/lib/types"
import { ActionButtonPair } from "@/components/feed/action-button-pair"
import { StepperNav } from "@/components/shared/stepper-nav"

interface CardActionStripProps {
  items: CardActionItem[]
  onResolvePermission: (id: string, verdict: string, alwaysAllow?: boolean) => void
  onResolvePlan: (id: string, verdict: string) => void
  onApply?: () => void
  onDismissSkill?: (skillId: string) => void
  onViewSkill?: (skillId: string) => void
}

export function CardActionStrip({
  items,
  onResolvePermission,
  onResolvePlan,
  onApply,
  onDismissSkill,
  onViewSkill,
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
              Unsaved changes
            </span>
            {onApply && (
              <button
                type="button"
                onClick={onApply}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent/10 transition-colors shrink-0"
              >
                <CheckCircle2 className="h-2.5 w-2.5" />
                Apply changes
              </button>
            )}
          </>
        )}

        {current.kind === "new-skill" && (
          <>
            <BookOpen className="h-3 w-3 text-accent shrink-0" />
            <span className="text-[11px] text-accent font-medium truncate flex-1 min-w-0">
              New skill available: {current.skillName}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {onViewSkill && (
                <button
                  type="button"
                  onClick={() => onViewSkill(current.skillId)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent/10 transition-colors"
                >
                  <BookOpen className="h-2.5 w-2.5" />
                  View
                </button>
              )}
              {onDismissSkill && (
                <button
                  type="button"
                  onClick={() => onDismissSkill(current.skillId)}
                  className="inline-flex items-center justify-center p-0.5 rounded text-accent/60 hover:text-accent hover:bg-accent/10 transition-colors"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
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
