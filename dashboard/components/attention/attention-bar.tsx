"use client"

import { useMemo, useCallback } from "react"
import {
  ChevronLeft,
  ChevronRight,
  X,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { PendingItem } from "@/lib/types"
import { useTeamStore } from "@/lib/stores/team"
import { useAgents, useResolvePermission, useResolvePlan } from "@/lib/graphql/hooks/use-agents"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { AgentAvatar } from "@/components/agent/avatar"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"

export function AttentionBar() {
  // ── Store subscriptions ───────────────────────────────────────────
  const feedItems = useTeamStore(s => s.feedItems)
  const { data } = useAgents()
  const agents = data?.agents ?? []
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
        const agent = agents.find(a => a.name === item.agent)
        result.push({ item: item as PendingItem, feedItemId: item.id, agentId: agent?.id })
      }
      if (item.type === "plan" && item.planStatus === "pending") {
        const agent = agents.find(a => a.name === item.agent)
        result.push({ item: item as PendingItem, feedItemId: item.id, agentId: agent?.id })
      }
    }
    return result
  }, [feedItems, agents])

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
  const hasPrev = clamped > 0
  const hasNext = clamped < sorted.length - 1

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
      <div className="px-6 mb-2 max-w-3xl mx-auto w-full">
        <div className="rounded-lg border border-warning/20 bg-warning-subtle/10 overflow-hidden flex flex-col">
          {/* Header: agent label + stepper + close */}
          <div className="px-3.5 pt-3 pb-2 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <span className="text-[11px] text-warning font-mono">{expandedPlan.item.agent} · Proposing a plan</span>
            <span className="flex-1" />
            {sorted.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => { setStepIdx(clamped - 1); setExpandedFeedItemId(null) }}
                  className={cn(
                    "p-0.5 rounded transition-colors",
                    hasPrev ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
                  )}
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="text-[10px] text-muted tabular-nums font-mono">
                  {clamped + 1}/{sorted.length}
                </span>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => { setStepIdx(clamped + 1); setExpandedFeedItemId(null) }}
                  className={cn(
                    "p-0.5 rounded transition-colors",
                    hasNext ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
                  )}
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
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
          <div className="border-t border-border-subtle/50 px-3.5 py-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleResolvePlanAndCollapse(expandedPlan.feedItemId, "approved")}
              className="px-3 py-1.5 rounded-md border border-success/30 text-xs font-medium text-success hover:bg-success-subtle/40 transition-colors"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => handleResolvePlanAndCollapse(expandedPlan.feedItemId, "rejected")}
              className="px-3 py-1.5 rounded-md border border-danger/30 text-xs font-medium text-danger hover:bg-danger-subtle/40 transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Collapsed compact bar
  return (
    <div className="px-6 mb-2 max-w-3xl mx-auto w-full"><div className="rounded-lg border border-warning/20 bg-warning-subtle/10 p-3">
      {/* Header: icon + count + stepper nav */}
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
        <span className="text-xs font-medium text-warning">
          {sorted.length} item{sorted.length !== 1 ? "s" : ""} need attention
        </span>
        {sorted.length > 1 && (
          <>
            <span className="flex-1" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => setStepIdx(clamped - 1)}
                className={cn(
                  "p-0.5 rounded transition-colors",
                  hasPrev ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
                )}
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="text-[10px] text-muted tabular-nums font-mono">
                {clamped + 1}/{sorted.length}
              </span>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => setStepIdx(clamped + 1)}
                className={cn(
                  "p-0.5 rounded transition-colors",
                  hasNext ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
                )}
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Current item */}
      <div className={cn("flex items-center gap-2 min-w-0", isFocused && "opacity-50")}>
        <AgentAvatar name={item.agent} size="sm" />
        <span className="text-[11px] text-secondary truncate flex-1 min-w-0">
          {item.type === "permission"
            ? `${item.agent} wants to run: ${item.command}`
            : `${item.agent} proposed: ${item.title}`}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {item.type === "permission" ? (
            <>
              <button
                type="button"
                onClick={() => resolvePermission(feedItemId, "allowed")}
                className="px-2 py-1 rounded text-[10px] font-medium text-success border border-success/30 hover:bg-success-subtle/40 transition-colors"
              >
                Allow
              </button>
              <button
                type="button"
                onClick={() => resolvePermission(feedItemId, "denied")}
                className="px-2 py-1 rounded text-[10px] font-medium text-danger border border-danger/30 hover:bg-danger-subtle/40 transition-colors"
              >
                Deny
              </button>
            </>
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
