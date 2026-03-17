/**
 * State consistency tests.
 *
 * Verifies that when shared state (Apollo cache) is updated, ALL components
 * that consume that state reflect the change. Catches the bug class where
 * the team feed panel shows data but the agent card silently drops it.
 *
 * Pattern:
 *   1. Seed Apollo cache with agent + feed items (simulating WS snapshot)
 *   2. Render TeamFeed → assert feed item text appears in the DOM
 *   3. Render AgentCardRow (expanded) → assert same text appears in card DOM
 *   4. Tests that FAIL prove the desync gap
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import { MockedProvider } from "@apollo/client/testing/react"
import type { MockedResponse } from "@apollo/client/testing"
import { InMemoryCache } from "@apollo/client"
import React, { type ReactNode } from "react"

import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { GET_FEED } from "@/lib/graphql/queries/feed"
import { GET_AGENT_TASKS } from "@/lib/graphql/queries/tasks"
import { GET_SKILLS } from "@/lib/graphql/queries/skills"

/* ================================================================== */
/*  MOCKS                                                               */
/*                                                                      */
/*  Mock heavy sub-components that crash in jsdom (VNC, settings, etc)  */
/*  and components with problematic ESM deps (react-markdown).          */
/* ================================================================== */

const MOCK_PROJECT_ID = "proj-vahid-eyorokon-001"

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: MOCK_PROJECT_ID }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

/* Agent card sub-components — heavy or need browser APIs */
vi.mock("@/components/agent/vnc-thumbnail", () => ({
  VncThumbnail: () => React.createElement("div", { "data-testid": "vnc-stub" }),
}))
vi.mock("@/components/agent/detail-feed", () => ({
  AgentDetailFeed: () => React.createElement("div", { "data-testid": "detail-feed-stub" }),
}))
vi.mock("@/components/agent/settings-panel", () => ({
  AgentSettingsPanel: React.forwardRef(function SettingsStub() {
    return React.createElement("div", { "data-testid": "settings-stub" })
  }),
}))
vi.mock("@/components/agent/skills-view", () => ({
  AgentSkillsView: () => React.createElement("div", { "data-testid": "skills-stub" }),
}))
vi.mock("@/components/agent/tasks-view", () => ({
  AgentTasksView: () => React.createElement("div", { "data-testid": "tasks-stub" }),
}))

/* Shared UI components */
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) =>
    React.createElement("div", { className, "data-testid": "scroll-area" }, children),
}))
vi.mock("@/components/shared/markdown-renderer", () => ({
  MarkdownRenderer: ({ content, className }: { content: string; className?: string }) =>
    React.createElement("span", { className }, content),
}))
vi.mock("@/components/shared/copy-button", () => ({
  CopyButton: () => null,
}))

/* ================================================================== */
/*  DYNAMIC IMPORTS (after mocks are registered)                        */
/* ================================================================== */

const { TeamFeed } = await import("@/components/feed/team-feed")
const { AgentCardRow } = await import("@/components/agent/card-row")
const { useSidebarStore } = await import("@/lib/stores/sidebar")

/* ================================================================== */
/*  FIXTURES                                                            */
/* ================================================================== */

/** Base agent shape matching AgentType GraphQL schema */
function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "AgentType" as const,
    id: "agent-1",
    name: "backend",
    lifecycleStatus: "running",
    attentionLevel: "none",
    relayConnected: true,
    mode: "auto",
    task: "Vahid Eyorokon requested this feature",
    cost: 0.42,
    duration: "5m",
    model: "claude-opus-4-6",
    turns: 12,
    phase: "coding",
    liveAction: "EditTool",
    lastOutput: "Done",
    errorMessage: null,
    tags: ["backend"],
    instructions: "Handle Django models",
    mcpServers: [],
    runtime: "docker",
    workspacePath: "/home/vahid-eyorokon/projects/agentobox",
    triggers: null,
    computeSeconds: 300,
    taskProgress: { __typename: "TaskProgressType" as const, done: 3, total: 5 },
    tasks: [],
    ...overrides,
  }
}

/** All TeamFeedItemType fields — null by default, override per item type */
function baseFeedItem(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "TeamFeedItemType" as const,
    id: "feed-item-1",
    type: "system",
    agent: null,
    agentId: null,
    text: null,
    command: null,
    risk: null,
    permStatus: null,
    title: null,
    plan: null,
    planStatus: null,
    summary: null,
    cost: null,
    turns: null,
    duration: null,
    from: null,
    to: null,
    target: null,
    question: null,
    options: null,
    questions: null,
    isError: null,
    ...overrides,
  }
}

function makePermissionItem(overrides: Record<string, unknown> = {}) {
  return baseFeedItem({
    id: "feed-perm-1",
    type: "permission",
    agent: "backend",
    agentId: "agent-1",
    command: "rm -rf /tmp/build",
    risk: "high",
    permStatus: "pending",
    ...overrides,
  })
}

function makeSummaryItem(overrides: Record<string, unknown> = {}) {
  return baseFeedItem({
    id: "feed-summary-1",
    type: "summary",
    agent: "backend",
    agentId: "agent-1",
    summary: "Vahid Eyorokon completed the refactoring task",
    cost: 0.35,
    turns: 8,
    duration: "3m",
    isError: false,
    ...overrides,
  })
}

function makeErrorItem(overrides: Record<string, unknown> = {}) {
  return baseFeedItem({
    id: "feed-error-1",
    type: "error",
    agent: "backend",
    agentId: "agent-1",
    text: "Agent crashed: out of memory",
    isError: true,
    ...overrides,
  })
}

function makePlanItem(overrides: Record<string, unknown> = {}) {
  return baseFeedItem({
    id: "feed-plan-1",
    type: "plan",
    agent: "backend",
    agentId: "agent-1",
    title: "Refactor models",
    plan: "Step 1: Extract base class\nStep 2: Migrate fields",
    planStatus: "pending",
    ...overrides,
  })
}

/* ================================================================== */
/*  TEST HELPERS                                                        */
/* ================================================================== */

function makeCache() {
  return new InMemoryCache({
    typePolicies: {
      AgentType: { keyFields: ["id"] },
      TeamFeedItemType: { keyFields: ["id"] },
      TaskProgressType: { keyFields: false },
    },
  })
}

function makeWrapper(mocks: MockedResponse[], cache?: InMemoryCache) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(
      MockedProvider,
      { mocks, cache: cache ?? makeCache() },
      children,
    )
  }
}

function agentsMock(agents = [makeAgent()]): MockedResponse {
  return {
    request: { query: GET_AGENTS, variables: { projectId: MOCK_PROJECT_ID } },
    result: { data: { agents } },
  }
}

function feedMock(items: Record<string, unknown>[]): MockedResponse {
  return {
    request: { query: GET_FEED, variables: { projectId: MOCK_PROJECT_ID } },
    result: { data: { feed: items } },
  }
}

function agentTasksMock(tasks: Record<string, unknown>[] = []): MockedResponse {
  return {
    request: { query: GET_AGENT_TASKS, variables: { agentId: "agent-1" } },
    result: { data: { agent: { __typename: "AgentType" as const, id: "agent-1", tasks } } },
  }
}

function skillsMock(skills: Record<string, unknown>[] = []): MockedResponse {
  return {
    request: { query: GET_SKILLS, variables: { projectId: MOCK_PROJECT_ID } },
    result: { data: { skills } },
  }
}

/* ================================================================== */
/*  STATE CONSISTENCY TESTS                                             */
/*                                                                      */
/*  Each describe block tests one feed item type across BOTH the team   */
/*  feed panel and the agent card. A test that passes in TeamFeed but   */
/*  fails in AgentCardRow proves a state→render gap.                    */
/* ================================================================== */

describe("state consistency: feed items visible across UI components", () => {

  afterEach(() => {
    cleanup()
    // Reset sidebar store between tests
    useSidebarStore.setState({ expandedAgentIds: new Set() })
  })

  /* ── Permission items ───────────────────────────────────────────── */

  describe("permission items", () => {
    const perm = makePermissionItem()

    it("renders in TeamFeed", async () => {
      render(
        React.createElement(TeamFeed),
        { wrapper: makeWrapper([agentsMock(), feedMock([perm])]) },
      )

      await waitFor(() => {
        expect(screen.getByText("rm -rf /tmp/build")).toBeTruthy()
      })
    })

    it("renders in AgentCardRow when expanded", async () => {
      // Expand the agent card in sidebar store
      useSidebarStore.setState({ expandedAgentIds: new Set(["agent-1"]) })

      render(
        React.createElement(AgentCardRow, { agent: makeAgent() } as any),
        { wrapper: makeWrapper([feedMock([perm]), agentTasksMock(), skillsMock()]) },
      )

      await waitFor(() => {
        // Permission command should appear in the CardActionStrip
        expect(screen.getByText("rm -rf /tmp/build")).toBeTruthy()
      })
    })
  })

  /* ── Plan items ─────────────────────────────────────────────────── */

  describe("plan items", () => {
    const plan = makePlanItem()

    it("renders in TeamFeed", async () => {
      render(
        React.createElement(TeamFeed),
        { wrapper: makeWrapper([agentsMock(), feedMock([plan])]) },
      )

      await waitFor(() => {
        expect(screen.getByText(/Refactor models/)).toBeTruthy()
      })
    })

    it("renders in AgentCardRow when expanded", async () => {
      useSidebarStore.setState({ expandedAgentIds: new Set(["agent-1"]) })

      render(
        React.createElement(AgentCardRow, { agent: makeAgent() } as any),
        { wrapper: makeWrapper([feedMock([plan]), agentTasksMock(), skillsMock()]) },
      )

      await waitFor(() => {
        // Plan title should appear in the CardActionStrip
        expect(screen.getByText(/Refactor models/)).toBeTruthy()
      })
    })
  })

  /* ── Summary items — feed only, NOT in card ───────────────────── */

  describe("summary items", () => {
    const summary = makeSummaryItem()

    it("renders in TeamFeed", async () => {
      render(
        React.createElement(TeamFeed),
        { wrapper: makeWrapper([agentsMock(), feedMock([summary])]) },
      )

      await waitFor(() => {
        expect(screen.getByText(/Vahid Eyorokon completed the refactoring/)).toBeTruthy()
      })
    })

    it("does NOT render in AgentCardRow — summaries live in the feed tab only", async () => {
      useSidebarStore.setState({ expandedAgentIds: new Set(["agent-1"]) })

      render(
        React.createElement(AgentCardRow, { agent: makeAgent() } as any),
        { wrapper: makeWrapper([feedMock([summary]), agentTasksMock(), skillsMock()]) },
      )

      // Wait for card to settle (composer @-mention is always present)
      await waitFor(() => {
        expect(screen.getAllByText(/@backend/).length).toBeGreaterThan(0)
      })

      // Summary text must NOT appear — the attention bar is for actionable items only
      expect(screen.queryByText(/Vahid Eyorokon completed the refactoring/)).toBeNull()
    })
  })

  /* ── Error items — feed only, NOT in card ────────────────────── */

  describe("error items", () => {
    const errorItem = makeErrorItem()

    it("renders in TeamFeed", async () => {
      render(
        React.createElement(TeamFeed),
        { wrapper: makeWrapper([agentsMock(), feedMock([errorItem])]) },
      )

      await waitFor(() => {
        expect(screen.getByText(/Agent crashed: out of memory/)).toBeTruthy()
      })
    })

    it("does NOT render in AgentCardRow — errors live in the feed tab only", async () => {
      useSidebarStore.setState({ expandedAgentIds: new Set(["agent-1"]) })

      render(
        React.createElement(AgentCardRow, { agent: makeAgent() } as any),
        { wrapper: makeWrapper([feedMock([errorItem]), agentTasksMock(), skillsMock()]) },
      )

      // Wait for card to settle
      await waitFor(() => {
        expect(screen.getAllByText(/@backend/).length).toBeGreaterThan(0)
      })

      // Error text must NOT appear — the attention bar is for actionable items only
      expect(screen.queryByText(/Agent crashed: out of memory/)).toBeNull()
    })
  })
})
