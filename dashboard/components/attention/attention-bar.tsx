"use client"

import { useMemo } from "react"
import {
  ChevronRight,
  X,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { PendingItem } from "@/lib/types"
import { useTeamStore } from "@/lib/stores/team"
import { useFeed, useResolvePermission, useResolvePlan } from "@/lib/graphql/hooks/use-feed"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { AgentTag } from "@/components/agent/avatar"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { ActionButtonPair } from "@/components/feed/action-button-pair"
import { StepperNav } from "@/components/shared/stepper-nav"

/* ── Main component ────────────────────────────────────────────────── */

export function AttentionBar() {
  // ── Store subscriptions ───────────────────────────────────────────
  const { data: feedData } = useFeed()
  const feedItems = feedData?.feed ?? []
  const resolvePermission = useResolvePermission()
  const resolvePlan = useResolvePlan()
  const reviewAgent = useTeamStore(s => s.reviewAgent)

  const focusedAgentId = useSidebarStore(s => s.focusedAgentId)
  const setMainTab = useSidebarStore(s => s.setMainTab)
  const stepIdx = useSidebarStore(s => s.attentionStepIdx)
  const setStepIdx = useSidebarStore(s => s.setAttentionStepIdx)
  const expandedFeedItemId = useSidebarStore(s => s.attentionExpandedFeedItemId)
  const setExpandedFeedItemId = useSidebarStore(s => s.setAttentionExpandedFeedItemId)

  // ── Derived: collect pending items with IDs ─────────────────────────
  const pending = useMemo(() => {
    const result: { item: PendingItem; feedItemId: string; agentId?: string }[] = []
    for (const item of feedItems) {
      if (item.type === "permission" && item.permStatus === "pending") {
        result.push({ item: item as PendingItem, feedItemId: item.id, agentId: item.agentId })
      }
      if (item.type === "plan" && item.planStatus === "pending") {
        result.push({ item: item as PendingItem, feedItemId: item.id, agentId: item.agentId })
      }
    }
    return result
  }, [feedItems])

  const expandedPlan = expandedFeedItemId !== null
    ? pending.find(p => p.feedItemId === expandedFeedItemId && p.item.type === "plan")
    : null

  if (pending.length === 0) return null

  // Sort: permissions first, then plans
  const sorted = [...pending].sort((a, b) => {
    const order = { permission: 0, plan: 1 }
    return (order[a.item.type] ?? 2) - (order[b.item.type] ?? 2)
  })

  // Clamp stepper to valid range when items resolve
  const clamped = Math.min(stepIdx, sorted.length - 1)
  const current = sorted[clamped]
  const { item, feedItemId, agentId } = current
  const isFocused = focusedAgentId != null && agentId === focusedAgentId

  const handleReview = (agentName: string, id: string) => {
    reviewAgent(agentName)
    setMainTab("chat")
    setExpandedFeedItemId(id)
  }

  const handleResolvePlanAndCollapse = (id: string, verdict: "approved" | "rejected") => {
    resolvePlan(id, verdict)
    setExpandedFeedItemId(null)
  }

  // Expanded view — the card IS the attention bar
  if (expandedPlan && expandedPlan.item.type === "plan") {
    return (
      <div className="px-3 @[640px]/main:px-6 mb-2 max-w-3xl mx-auto w-full">
        <div className="rounded-lg border border-warning/20 bg-warning-subtle/10 overflow-hidden flex flex-col">
          {/* Header: agent label + stepper + close */}
          <div className="px-3.5 pt-3 pb-2 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-[11px] text-warning font-mono">{expandedPlan.item.agent} · Proposing a plan</span>
            <span className="flex-1" />
            <StepperNav
              current={clamped}
              total={sorted.length}
              onPrev={() => { setStepIdx(clamped - 1); setExpandedFeedItemId(null) }}
              onNext={() => { setStepIdx(clamped + 1); setExpandedFeedItemId(null) }}
            />
            <button
              type="button"
              onClick={() => setExpandedFeedItemId(null)}
              className="p-0.5 rounded text-muted hover:text-default hover:bg-surface-raised/50 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* Title */}
          <div className="px-3.5 pb-2">
            <p className="text-[13px] font-medium text-default leading-snug">{expandedPlan.item.title}</p>
          </div>

          {/* Scrollable markdown body */}
          <div className="border-t border-border-subtle/50 px-3.5 py-3 max-h-[35vh] overflow-y-auto">
            <MarkdownRenderer
              content={expandedPlan.item.plan}
              className="text-xs text-secondary [&_h2]:text-[11px] [&_h2]:font-mono [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-muted [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:first:mt-0 [&_ol]:space-y-1 [&_ul]:space-y-0.5 [&_li]:text-xs [&_li]:leading-relaxed [&_code]:text-[10px] [&_code]:bg-surface-sunken/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_p]:leading-relaxed [&_p]:mb-1.5"
            />
          </div>

          {/* Pinned footer — always visible */}
          <div className="border-t border-border-subtle/50 px-3.5 py-2.5">
            <ActionButtonPair
              onPositive={() => handleResolvePlanAndCollapse(expandedPlan.feedItemId, "approved")}
              onNegative={() => handleResolvePlanAndCollapse(expandedPlan.feedItemId, "rejected")}
              positiveLabel="Approve"
              negativeLabel="Reject"
            />
          </div>
        </div>
      </div>
    )
  }

  // Collapsed compact bar
  return (
    <div className="px-3 @[640px]/main:px-6 mb-2 max-w-3xl mx-auto w-full"><div className="rounded-lg border border-warning/20 bg-warning-subtle/10 p-3">
      {/* Header: icon + count + stepper nav */}
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
        <span className="text-xs font-medium text-warning">
          {sorted.length} item{sorted.length !== 1 ? "s" : ""} need attention
        </span>
        {sorted.length > 1 && (
          <>
            <span className="flex-1" />
            <StepperNav
              current={clamped}
              total={sorted.length}
              onPrev={() => setStepIdx(clamped - 1)}
              onNext={() => setStepIdx(clamped + 1)}
            />
          </>
        )}
      </div>

      {/* Current item */}
      <div className={cn("flex items-center gap-2 min-w-0", isFocused && "opacity-50")}>
        <AgentTag name={item.agent} />
        <span className="text-[11px] text-secondary truncate flex-1 min-w-0">
          {item.type === "permission"
            ? `wants to run: ${item.command}`
            : `proposed: ${item.title}`}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {item.type === "permission" ? (
            <ActionButtonPair
              onPositive={() => resolvePermission(feedItemId, "allowed")}
              onNegative={() => resolvePermission(feedItemId, "denied")}
              positiveLabel="Allow"
              negativeLabel="Deny"
            />
          ) : (
            <button
              type="button"
              onClick={() => handleReview(item.agent, feedItemId)}
              className="px-2 py-1 rounded text-[10px] font-medium text-warning border border-warning/30 hover:bg-warning-subtle/40 transition-colors inline-flex items-center gap-1"
            >
              Review <ChevronRight className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>
    </div></div>
  )
}
