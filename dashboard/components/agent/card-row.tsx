"use client"

import { useState, useMemo } from "react"
import {
  ArrowUp,
  ChevronRight,
  Check,
  CheckSquare,
  Shield,
  Monitor,
  List,
  BookOpen,
  Settings,
} from "lucide-react"
import { cn, formatCost } from "@/lib/utils"
import { LIFECYCLE_CONFIG, ATTENTION_CONFIG, MODE_CONFIG } from "@/lib/config"
import { getPendingItemsForAgent } from "@/lib/attention"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useAcknowledgeAgent, useSetAgentMode } from "@/lib/graphql/hooks/use-agents"
import { useFeed, useResolvePermission, useResolvePlan, useSendMessage } from "@/lib/graphql/hooks/use-feed"
import { Collapsible } from "@/components/ui/collapsible"
import { AgentAvatar } from "@/components/agent/avatar"
import { ModePill } from "@/components/agent/mode-pill"
import { VncThumbnail } from "@/components/agent/vnc-thumbnail"
import { AgentDetailFeed } from "@/components/agent/detail-feed"
import { AgentSettingsPanel } from "@/components/agent/settings-panel"
import { AgentSkillsView } from "@/components/agent/skills-view"
import type { Agent, AttentionLevel, PendingItem, ViewMode } from "@/lib/types"

export interface AgentCardRowProps {
  agent: Agent
  selectable?: boolean
  selected?: boolean
  onSelect?: () => void
}

/**
 * Agent card -- two states:
 *
 * COLLAPSED -- compact single row:
 *   avatar | name | status dot | live action | cost . time | chevron
 *
 * OPEN -- content area + bottom toolbar:
 *   header row -> content (VNC / feed / settings) -> toolbar (view icons + composer + todo)
 */
export function AgentCardRow({
  agent,
  selectable = false,
  selected = false,
  onSelect,
}: AgentCardRowProps) {
  const config = LIFECYCLE_CONFIG[agent.lifecycleStatus]
  const isRunning = agent.lifecycleStatus === "running"
  const isError = agent.lifecycleStatus === "error"
  const isStopped = agent.lifecycleStatus === "stopped"

  // Store state — card subscribes to exactly the slices it needs
  const isExpanded = useSidebarStore(s => s.expandedAgentIds.has(agent.id))
  const toggleAgent = useSidebarStore(s => s.toggleAgent)
  const acknowledgeAgent = useAcknowledgeAgent()
  const setAgentMode = useSetAgentMode()
  const { data: feedData } = useFeed()
  const feedItems = feedData?.feed ?? []
  const resolvePermission = useResolvePermission()
  const resolvePlan = useResolvePlan()
  const sendMessage = useSendMessage()
  const handleModeChange = (mode: Agent["mode"]) => setAgentMode(agent.id, mode)

  // Derived from store
  const isOpen = !selectable && isExpanded
  const pendingItems = useMemo(() => getPendingItemsForAgent(feedItems, agent.name), [feedItems, agent.name])

  // Ephemeral state — view tab resets when card collapses
  const [viewMode, setViewMode] = useState<ViewMode>("terminal")
  const [composerText, setComposerText] = useState("")

  const handleSendMessage = () => {
    const text = composerText.trim()
    if (!text) return
    sendMessage(text, [{ type: "agent", value: agent.name }])
    setComposerText("")
  }

  const hasAttention = agent.attentionLevel !== "none"
  const attCfg = hasAttention ? ATTENTION_CONFIG[agent.attentionLevel as Exclude<AttentionLevel, "none">] : null
  const hasPendingItem = pendingItems.length > 0

  const VIEW_MODES: { id: ViewMode; icon: typeof Monitor; label: string }[] = [
    { id: "terminal", icon: Monitor, label: "Screen" },
    { id: "feed", icon: List, label: "Feed" },
    { id: "skills", icon: BookOpen, label: "Skills" },
    { id: "settings", icon: Settings, label: "Settings" },
  ]

  return (
    <div
      className={cn(
        "rounded-lg border transition-all duration-(--duration-normal)",
        isOpen
          ? cn("border-accent/40 bg-surface-raised/80 shadow-sm", isError && "border-danger/40")
          : cn(
              "border-border-subtle bg-surface hover:bg-surface-raised/40 hover:border-border-default",
              isError && "border-danger/30 hover:border-danger/40",
              isStopped && "opacity-60",
            ),
      )}
    >
      {/* Header row -- div instead of button to allow nested interactive ModePill */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (selectable && onSelect) {
            onSelect()
          } else {
            toggleAgent(agent.id)
            acknowledgeAgent(agent.id)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            if (selectable && onSelect) onSelect()
            else { toggleAgent(agent.id); acknowledgeAgent(agent.id) }
          }
        }}
        className="w-full text-left px-2.5 py-2 cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectable && (
            <div
              className={cn(
                "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                selected
                  ? "bg-accent/20 border-accent/50"
                  : "border-border-default",
              )}
            >
              {selected && <Check className="h-2.5 w-2.5 text-accent" strokeWidth={3} />}
            </div>
          )}
          <div className="relative shrink-0">
            <AgentAvatar name={agent.name} size="sm" stopped={isStopped} />
            {/* Attention dot overlay on avatar -- takes precedence over lifecycle */}
            {hasAttention && attCfg && (
              <span
                className={cn(
                  "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface",
                  attCfg.dot,
                  attCfg.pulse && "animate-breathe",
                )}
              />
            )}
          </div>
          <span
            className={cn(
              "text-[12px] font-medium shrink-0",
              isStopped ? "text-muted" : "text-default",
            )}
          >
            {agent.name}
          </span>
          <ModePill mode={agent.mode} onChange={handleModeChange} />
          {/* Tag pills -- show 1 + overflow count, shrink before mode */}
          {agent.tags.length > 0 && (
            <span className="inline-flex items-center gap-1 shrink min-w-0 overflow-hidden">
              <span className="px-1.5 py-px rounded text-[9px] font-mono text-muted bg-surface-sunken/60 border border-border-subtle truncate">
                {agent.tags[0]}
              </span>
              {agent.tags.length > 1 && (
                <span className="text-[9px] text-muted/40 font-mono shrink-0">+{agent.tags.length - 1}</span>
              )}
            </span>
          )}
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              config.dot,
              isRunning && "animate-breathe text-success",
            )}
          />

          {/* Live action one-liner */}
          {agent.liveAction ? (
            <span className="text-[10px] text-muted font-mono truncate flex-1 min-w-0">
              {agent.liveAction}
            </span>
          ) : (
            <span className="text-[10px] text-muted/50 font-mono truncate flex-1 min-w-0">
              {agent.task}
            </span>
          )}

          {/* Right: cost . time + chevron */}
          <span className="text-[9px] text-muted/60 font-mono tabular-nums shrink-0">
            {formatCost(agent.cost)} · {agent.duration}
          </span>
          <ChevronRight
            size={14}
            className={cn(
              "shrink-0 text-muted transition-transform duration-(--duration-normal)",
              isOpen && "rotate-90",
            )}
          />
        </div>
      </div>

      {/* Open content -- animated reveal */}
      <Collapsible open={isOpen}>
        {/* Content area -- swaps based on view mode */}
        <div className="px-3 pb-2">
          {viewMode === "terminal" && <VncThumbnail agent={agent} />}
          {viewMode === "feed" && <AgentDetailFeed agent={agent} />}
          {viewMode === "skills" && <AgentSkillsView agent={agent} />}
          {viewMode === "settings" && <AgentSettingsPanel agent={agent} />}
        </div>

        {/* Bottom toolbar -- swaps entirely when agent needs attention */}
        {hasPendingItem ? (
          <div className="border-t border-warning/20 bg-warning-subtle/10 px-3 py-2">
            {pendingItems.map((item) => (
              <div key={item.id} className="flex items-center gap-2 min-w-0">
                <Shield className="h-3.5 w-3.5 text-warning shrink-0" />
                <span className="text-[11px] text-warning font-medium truncate flex-1 min-w-0">
                  {item.type === "permission"
                    ? item.command
                    : item.title}
                </span>
                {item.type === "permission" ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => resolvePermission(item.id, "allowed")}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium text-success border border-success/30 hover:bg-success-subtle/40 transition-colors"
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      onClick={() => resolvePermission(item.id, "denied")}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium text-danger border border-danger/30 hover:bg-danger-subtle/40 transition-colors"
                    >
                      Deny
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => resolvePlan(item.id, "approved")}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium text-success border border-success/30 hover:bg-success-subtle/40 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => resolvePlan(item.id, "rejected")}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium text-danger border border-danger/30 hover:bg-danger-subtle/40 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-border-subtle bg-surface-sunken/20">
            {/* View mode icons */}
            <div className="flex items-center gap-0.5 shrink-0">
              {VIEW_MODES.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setViewMode(id)}
                  className={cn(
                    "p-1 rounded transition-colors",
                    viewMode === id
                      ? "bg-surface-raised text-default"
                      : "text-muted/50 hover:text-secondary hover:bg-surface-raised/40",
                  )}
                  title={label}
                >
                  <Icon className="h-3 w-3" />
                </button>
              ))}
            </div>

            {/* Mini composer */}
            <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded border border-border-default bg-surface-sunken/40 px-2 py-1">
              <span className="text-[9px] text-accent font-mono shrink-0">@{agent.name}</span>
              <input
                type="text"
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }}
                placeholder="Message..."
                className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
              />
              <button
                type="button"
                onClick={handleSendMessage}
                className={cn(
                  "flex items-center justify-center h-4 w-4 rounded-full shrink-0 transition-colors",
                  composerText.trim()
                    ? "bg-accent text-on-emphasis"
                    : "bg-surface text-muted",
                )}
              >
                <ArrowUp className="h-2.5 w-2.5" strokeWidth={2.5} />
              </button>
            </div>

            {/* Todo progress */}
            {agent.todoProgress && (
              <span className="flex items-center gap-1 shrink-0">
                <CheckSquare className="h-3 w-3 text-muted/50" />
                <span className="text-[9px] font-mono text-muted tabular-nums">
                  {agent.todoProgress.done}/{agent.todoProgress.total}
                </span>
              </span>
            )}
          </div>
        )}
      </Collapsible>
    </div>
  )
}
