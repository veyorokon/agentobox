"use client"

import { useEffect, useMemo, useState } from "react"
import { Shield, FileText, AlertTriangle, BookOpen, X, CheckCircle2, Loader2 } from "lucide-react"
import type { CardActionItem } from "@/lib/types"
import { ActionButtonPair } from "@/components/feed/action-button-pair"
import { StepperNav } from "@/components/shared/stepper-nav"

interface CardActionStripProps {
  items: CardActionItem[]
  onResolvePermission: (id: string, verdict: string, alwaysAllow?: boolean) => void
  onResolvePlan: (id: string, verdict: string) => void
  onSave?: () => void
  onDismissSkill?: (skillId: string) => void
  onViewSkill?: (skillId: string) => void
}

export function CardActionStrip({
  items,
  onResolvePermission,
  onResolvePlan,
  onSave,
  onDismissSkill,
  onViewSkill,
}: CardActionStripProps) {
  const [stepIdx, setStepIdx] = useState(0)
  const [dismissedSaveErrorKey, setDismissedSaveErrorKey] = useState<string | null>(null)

  if (items.length === 0) return null

  const getSaveErrorKey = (item: CardActionItem): string | null =>
    item.kind === "config-sync" && item.syncState.status === "save-error"
      ? item.syncState.message || "Save failed"
      : null

  const visibleItems = useMemo(
    () =>
      items.filter(item => {
        const saveErrorKey = getSaveErrorKey(item)
        return !saveErrorKey || saveErrorKey !== dismissedSaveErrorKey
      }),
    [items, dismissedSaveErrorKey],
  )

  useEffect(() => {
    if (!dismissedSaveErrorKey) return
    const hasDismissedError = items.some(item => getSaveErrorKey(item) === dismissedSaveErrorKey)
    if (!hasDismissedError) setDismissedSaveErrorKey(null)
  }, [items, dismissedSaveErrorKey])

  if (visibleItems.length === 0) return null

  const clamped = Math.min(stepIdx, visibleItems.length - 1)
  const current = visibleItems[clamped]

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

        {current.kind === "config-sync" && current.syncState.status === "unsaved" && (
          <>
            <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
            <span className="text-[11px] text-warning font-medium truncate flex-1 min-w-0">
              Unsaved changes
            </span>
            {onSave && (
              <button
                type="button"
                onClick={onSave}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent/10 transition-colors shrink-0"
              >
                <CheckCircle2 className="h-2.5 w-2.5" />
                Save changes
              </button>
            )}
          </>
        )}

        {current.kind === "config-sync" && current.syncState.status === "saving" && (
          <>
            <Loader2 className="h-3 w-3 text-muted animate-spin shrink-0" />
            <span className="text-[11px] text-muted font-medium truncate flex-1 min-w-0">
              Saving...
            </span>
          </>
        )}

        {current.kind === "config-sync" && current.syncState.status === "save-error" && (
          <>
            <AlertTriangle className="h-3 w-3 text-danger shrink-0" />
            <span className="text-[11px] text-danger font-medium truncate flex-1 min-w-0">
              {current.syncState.message || "Save failed"}
            </span>
            {onSave && (
              <button
                type="button"
                onClick={() => {
                  setDismissedSaveErrorKey(null)
                  onSave()
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent/10 transition-colors shrink-0"
              >
                <CheckCircle2 className="h-2.5 w-2.5" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setDismissedSaveErrorKey(getSaveErrorKey(current))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-muted border border-border-subtle hover:bg-surface-raised/40 transition-colors shrink-0"
            >
              <X className="h-2.5 w-2.5" />
              Dismiss
            </button>
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
          total={visibleItems.length}
          onPrev={() => setStepIdx(clamped - 1)}
          onNext={() => setStepIdx(clamped + 1)}
        />
      </div>
    </div>
  )
}
