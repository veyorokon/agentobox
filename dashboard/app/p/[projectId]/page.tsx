"use client"

import { useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@apollo/client/react"
import {
  CheckSquare,
  ChevronRight,
  KeyRound,
  MessageSquare,
  Users,
  BookOpen,
} from "lucide-react"
import { GET_PROJECT } from "@/lib/graphql/queries/projects"
import { formatCost } from "@/lib/utils"
import { getAllPendingItems } from "@/lib/attention"
import { useBreakpoint } from "@/lib/hooks/use-breakpoint"
import { useProjectWebSocket } from "@/lib/hooks/use-project-ws"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useAgents } from "@/lib/graphql/hooks/use-agents"
import { useFeed } from "@/lib/graphql/hooks/use-feed"
import { useProviderStatus } from "@/lib/graphql/hooks/use-models"

import { SecretsModal } from "@/components/panels/secrets-modal"
import { CreateAgentModal } from "@/components/agent/create-agent-modal"
import { AgentLeftPanel } from "@/components/panels/left-panel"
import { AgentCardsPanel } from "@/components/panels/agent-cards-panel"
import { SkillsPanel } from "@/components/panels/skills-panel"
import { TasksPanel } from "@/components/panels/tasks-panel"
import { TabBar } from "@/components/layout/tab-bar"
import { AttentionBar } from "@/components/attention/attention-bar"
import { TeamFeed } from "@/components/feed/team-feed"
import { ComposerBar } from "@/components/composer/composer-bar"
import { UserMenu } from "@/components/layout/user-menu"
import { ThemePicker } from "@/components/layout/theme-picker"

/* ================================================================== */
/*  PROJECT DASHBOARD PAGE                                             */
/*                                                                     */
/*  Pure layout shell — all components subscribe to stores directly.  */
/*  Page only owns: breakpoint, mobile tab, secrets modal, and the    */
/*  mobile header (cost display + TabBar badge count).                */
/* ================================================================== */

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  useProjectWebSocket(projectId)

  const bp = useBreakpoint()

  // ── Project name (for breadcrumb) ─────────────────────────────────
  const { data: projectData, loading: projectLoading } = useQuery<{ project: { id: string; name: string } | null }>(GET_PROJECT, {
    variables: { id: projectId },
    skip: !projectId,
  })
  const projectName = projectData?.project?.name ?? ""

  // ── Sidebar store (mobile tab) ──────────────────────────────────
  const mainTab = useSidebarStore(s => s.mainTab)
  const setMainTab = useSidebarStore(s => s.setMainTab)

  // ── Apollo (agents + feed + providers) ─────────────────────────
  const { providers } = useProviderStatus(projectId ?? "")
  const missingKeys = providers.filter((p) => !p.configured)
  const { data: agentsData, loading: agentsLoading } = useAgents()
  const agents = agentsData?.agents ?? []
  const { data: feedData } = useFeed()
  const feedItems = feedData?.feed ?? []
  const headerReady = !projectLoading && !agentsLoading && !!projectName

  // ── Local state ─────────────────────────────────────────────────
  const [secretsOpen, setSecretsOpen] = useState(false)
  const [createAgentOpen, setCreateAgentOpen] = useState(false)

  // ── Derived (TabBar badge) ──────────────────────────────────────
  const pendingCount = useMemo(() => getAllPendingItems(feedItems).length, [feedItems])

  // ── Layout ──────────────────────────────────────────────────────
  const showTopTabs = bp === "mobile"
  const showLeftPanel = bp !== "mobile"

  const topTabs = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: "agents", label: "Agents", icon: <Users className="h-3.5 w-3.5" /> },
    { id: "skills", label: "Skills", icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: "tasks", label: "Tasks", icon: <CheckSquare className="h-3.5 w-3.5" /> },
  ]

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="h-screen flex bg-surface overflow-hidden cursor-default">
      <h1 className="sr-only">Agentobox Dashboard</h1>

      <SecretsModal
        open={secretsOpen}
        onClose={() => setSecretsOpen(false)}
      />

      <CreateAgentModal
        open={createAgentOpen}
        onClose={() => setCreateAgentOpen(false)}
      />

      {showLeftPanel && (
        <AgentLeftPanel
          onOpenSecrets={() => setSecretsOpen(true)}
          onCreateAgent={() => setCreateAgentOpen(true)}
        />
      )}

      <div className="@container/main flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Mobile header: project + secrets + user */}
        {bp === "mobile" && (
          <div className="h-10 px-3 flex items-center border-b border-border-default bg-surface shrink-0">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="text-[11px] text-muted hover:text-accent transition-colors shrink-0"
            >
              Global
            </button>
            <ChevronRight className="h-2.5 w-2.5 text-muted/30 shrink-0" />
            {headerReady ? (
              <>
                <span className="text-[11px] text-default font-medium truncate">{projectName}</span>
                <span className="text-[10px] text-muted/60 font-mono tabular-nums ml-1.5">
                  {formatCost(agents.reduce((s, a) => s + a.cost, 0))}
                </span>
              </>
            ) : (
              <>
                <span className="inline-block w-14 h-3 rounded bg-surface-raised/60 animate-pulse" />
                <span className="inline-block w-8 h-2.5 rounded bg-surface-raised/40 animate-pulse ml-1.5" />
              </>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setSecretsOpen(true)}
              className="relative p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
              title={missingKeys.length > 0 ? `${missingKeys.length} key${missingKeys.length !== 1 ? "s" : ""} missing` : "Project secrets"}
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
            <ThemePicker className="shrink-0" />
            <UserMenu>
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-on-emphasis bg-accent cursor-pointer hover:ring-2 hover:ring-accent/30 transition-shadow"
                title="vahid"
              >
                V
              </div>
            </UserMenu>
          </div>
        )}

        {/* Top tabs (mobile) */}
        {showTopTabs && (
          <TabBar
            tabs={topTabs}
            activeTab={mainTab}
            onTabChange={(id) => setMainTab(id as "chat" | "agents" | "skills" | "tasks")}
            badges={pendingCount > 0 ? { chat: pendingCount } : undefined}
          />
        )}

        {/* Center: team feed + attention bar + composer */}
        {(!showTopTabs || mainTab === "chat") && (
          <main className="flex-1 min-w-0 flex flex-col min-h-0 bg-surface-raised">
            <TeamFeed />
            <AttentionBar />
            <ComposerBar />
          </main>
        )}

        {/* Top-tab content: agents (mobile) */}
        {showTopTabs && mainTab === "agents" && (
          <div className="flex-1 min-w-0 bg-surface flex flex-col overflow-hidden">
            <AgentCardsPanel />
            <AttentionBar />
          </div>
        )}

        {/* Top-tab content: skills (mobile) */}
        {showTopTabs && mainTab === "skills" && (
          <div className="flex-1 min-w-0 bg-surface overflow-hidden flex flex-col">
            <SkillsPanel />
            <AttentionBar />
          </div>
        )}

        {/* Top-tab content: tasks (mobile) */}
        {showTopTabs && mainTab === "tasks" && (
          <div className="flex-1 min-w-0 bg-surface overflow-hidden flex flex-col">
            <TasksPanel />
            <AttentionBar />
          </div>
        )}
      </div>

    </div>
  )
}
