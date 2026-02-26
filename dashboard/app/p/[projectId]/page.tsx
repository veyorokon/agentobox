"use client"

import { useState, useCallback, useMemo } from "react"
import {
  ChevronRight,
  KeyRound,
  MessageSquare,
  Users,
  BookOpen,
} from "lucide-react"
import { formatCost } from "@/lib/utils"
import { ALL_TAGS } from "@/lib/data/mock"
import { getAllPendingItems } from "@/lib/attention"
import { useBreakpoint } from "@/hooks/use-breakpoint"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useTeamStore } from "@/lib/stores/team"

import { SecretsModal } from "@/components/panels/secrets-modal"
import { AgentLeftPanel } from "@/components/panels/left-panel"
import { AgentCardsPanel } from "@/components/panels/agent-cards-panel"
import { SkillsPanel } from "@/components/panels/skills-panel"
import { TabBar } from "@/components/layout/tab-bar"
import { BreakpointIndicator } from "@/components/layout/breakpoint-indicator"
import { AttentionBar } from "@/components/attention/attention-bar"
import { TeamFeed } from "@/components/feed/team-feed"
import { ComposerBar } from "@/components/composer/composer-bar"

/* ================================================================== */
/*  PROJECT DASHBOARD PAGE                                             */
/*                                                                     */
/*  Layout shell — composes panels and wires right-column components.  */
/*  Left column components subscribe to stores directly (no props).    */
/* ================================================================== */

export default function ProjectPage() {
  const bp = useBreakpoint()

  // ── Sidebar store (page only needs mobile tab) ────────────────────
  const mainTab = useSidebarStore(s => s.mainTab)
  const setMainTab = useSidebarStore(s => s.setMainTab)
  const focusedAgentId = useSidebarStore(s => s.focusedAgentId)

  // ── Team store (right column still prop-drilled for now) ──────────
  const agents = useTeamStore(s => s.agents)
  const feedItems = useTeamStore(s => s.feedItems)
  const recipients = useTeamStore(s => s.recipients)
  const resolvePermission = useTeamStore(s => s.resolvePermission)
  const resolvePlan = useTeamStore(s => s.resolvePlan)
  const addRecipient = useTeamStore(s => s.addRecipient)
  const removeRecipient = useTeamStore(s => s.removeRecipient)
  const reviewAgent = useTeamStore(s => s.reviewAgent)

  // ── Local state (ephemeral — resets on unmount, single-component) ──
  const [secretsOpen, setSecretsOpen] = useState(false)

  // ── Handlers (right column) ───────────────────────────────────────

  const handleReviewAgent = useCallback((agentName: string) => {
    reviewAgent(agentName)
    setMainTab("chat")
  }, [reviewAgent, setMainTab])

  const handleFeedClickAgent = useCallback((agentName: string) => {
    reviewAgent(agentName)
    setMainTab("chat")
  }, [reviewAgent, setMainTab])

  // ── Derived values (right column) ─────────────────────────────────

  const pendingCount = useMemo(() => getAllPendingItems(feedItems).length, [feedItems])

  const isDefaultRecipient = recipients.length === 1 && recipients[0].type === "agent" && recipients[0].value === "team-lead"

  const effectiveAgentFilter = useMemo(() => {
    if (isDefaultRecipient) return new Set<string>()
    if (recipients.some(r => r.type === "all")) return new Set<string>()
    if (recipients.length === 0) return new Set<string>()
    const names = new Set<string>()
    for (const r of recipients) {
      if (r.type === "agent") names.add(r.value)
      else if (r.type === "tag") for (const a of agents) { if (a.tags.includes(r.value)) names.add(a.name) }
    }
    return names
  }, [recipients, agents, isDefaultRecipient])

  // ── Layout ────────────────────────────────────────────────────────

  const showTopTabs = bp === "mobile"
  const showLeftPanel = bp !== "mobile"

  const topTabs = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: "agents", label: "Agents", icon: <Users className="h-3.5 w-3.5" /> },
    { id: "skills", label: "Skills", icon: <BookOpen className="h-3.5 w-3.5" /> },
  ]

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex bg-surface overflow-hidden cursor-default">
      <h1 className="sr-only">Agentobox Dashboard</h1>

      <SecretsModal
        open={secretsOpen}
        onClose={() => setSecretsOpen(false)}
      />

      {showLeftPanel && (
        <AgentLeftPanel onOpenSecrets={() => setSecretsOpen(true)} />
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Mobile header: project + secrets + user */}
        {bp === "mobile" && (
          <div className="h-10 px-3 flex items-center border-b border-border-default bg-surface shrink-0">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-1 py-1 -ml-1 rounded-md hover:bg-surface-sunken/40 transition-colors min-w-0"
            >
              <div className="h-6 w-6 rounded-md bg-accent/15 flex items-center justify-center text-[11px] font-bold text-accent shrink-0">
                A
              </div>
              <span className="text-sm font-medium text-default truncate">agentobox</span>
              <ChevronRight size={12} className="text-muted/40 rotate-90 shrink-0" />
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setSecretsOpen(true)}
              className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
              title="Project secrets"
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
            <span className="text-[10px] text-muted/60 font-mono tabular-nums mx-1.5">
              {formatCost(agents.reduce((s, a) => s + a.cost, 0))}
            </span>
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent"
              title="vahid"
            >
              V
            </div>
          </div>
        )}

        {/* Top tabs (mobile) */}
        {showTopTabs && (
          <TabBar
            tabs={topTabs}
            activeTab={mainTab}
            onTabChange={(id) => setMainTab(id as "chat" | "agents" | "skills")}
            badges={pendingCount > 0 ? { chat: pendingCount } : undefined}
          />
        )}

        {/* Center: team feed + attention bar + composer */}
        {(!showTopTabs || mainTab === "chat") && (
          <main className="flex-1 min-w-0 flex flex-col min-h-0">
            <TeamFeed
              feedItems={feedItems}
              agentFilter={effectiveAgentFilter}
              onClickAgent={handleFeedClickAgent}
            />
            <AttentionBar
              feedItems={feedItems}
              focusedAgentId={focusedAgentId}
              agents={agents}
              onResolvePermission={resolvePermission}
              onResolvePlan={resolvePlan}
              onReviewAgent={handleReviewAgent}
            />
            <ComposerBar
              recipients={recipients}
              agents={agents}
              allTags={ALL_TAGS}
              onAddRecipient={addRecipient}
              onRemoveRecipient={removeRecipient}
            />
          </main>
        )}

        {/* Top-tab content: agents (mobile) */}
        {showTopTabs && mainTab === "agents" && (
          <div className="flex-1 min-w-0 bg-surface flex flex-col overflow-hidden">
            <AgentCardsPanel />
            <AttentionBar
              feedItems={feedItems}
              focusedAgentId={focusedAgentId}
              agents={agents}
              onResolvePermission={resolvePermission}
              onResolvePlan={resolvePlan}
              onReviewAgent={handleReviewAgent}
            />
          </div>
        )}

        {/* Top-tab content: skills (mobile) */}
        {showTopTabs && mainTab === "skills" && (
          <div className="flex-1 min-w-0 bg-surface overflow-hidden flex flex-col">
            <SkillsPanel />
            <AttentionBar
              feedItems={feedItems}
              focusedAgentId={focusedAgentId}
              agents={agents}
              onResolvePermission={resolvePermission}
              onResolvePlan={resolvePlan}
              onReviewAgent={handleReviewAgent}
            />
          </div>
        )}
      </div>

      <BreakpointIndicator bp={bp} />
    </div>
  )
}
