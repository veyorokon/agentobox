/**
 * Control verb regression tests.
 *
 * Proves the visible agent control surface stays honest:
 * - no visible "Restart" label anywhere
 * - "Clear Session" only for running/idle agents
 * - "Interrupt" only for running agents
 * - "Redeploy" always visible (canonical reprovision verb)
 *
 * Prevents regression of #149 (honest control semantics).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import React, { type ReactNode } from "react"
import { MockedProvider } from "@apollo/client/testing/react"
import type { MockedResponse } from "@apollo/client/testing"
import { InMemoryCache } from "@apollo/client"

import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { GET_FEED } from "@/lib/graphql/queries/feed"
import { GET_AGENT_TASKS } from "@/lib/graphql/queries/tasks"
import { GET_SKILLS } from "@/lib/graphql/queries/skills"

/* ================================================================== */
/*  MOCKS                                                               */
/* ================================================================== */

const MOCK_PROJECT_ID = "proj-vahid-eyorokon-001"

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: MOCK_PROJECT_ID }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

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
/*  DYNAMIC IMPORTS                                                     */
/* ================================================================== */

const { AgentCardRow } = await import("@/components/agent/card-row")
const { useSidebarStore } = await import("@/lib/stores/sidebar")

/* ================================================================== */
/*  FIXTURES                                                            */
/* ================================================================== */

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "AgentType" as const,
    id: "agent-1",
    name: "vahid-worker",
    lifecycleStatus: "running",
    previewState: "ready",
    previewRuntimeId: "sandbox-agent-1",
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
    instructions: "Handle Django models for Vahid Eyorokon",
    mcpServers: [],
    runtime: "modal",
    workspacePath: "/home/vahid-eyorokon/projects/agentobox",
    triggers: null,
    computeSeconds: 300,
    taskProgress: { __typename: "TaskProgressType" as const, done: 3, total: 5 },
    tasks: [],
    ...overrides,
  }
}

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

function feedMock(items: Record<string, unknown>[] = []): MockedResponse {
  return {
    request: { query: GET_FEED, variables: { projectId: MOCK_PROJECT_ID } },
    result: { data: { feed: items } },
  }
}

function agentTasksMock(): MockedResponse {
  return {
    request: { query: GET_AGENT_TASKS, variables: { agentId: "agent-1" } },
    result: { data: { agent: { __typename: "AgentType" as const, id: "agent-1", tasks: [] } } },
  }
}

function skillsMock(): MockedResponse {
  return {
    request: { query: GET_SKILLS, variables: { projectId: MOCK_PROJECT_ID } },
    result: { data: { skills: [] } },
  }
}

const standardMocks = () => [feedMock(), agentTasksMock(), skillsMock()]

/** Render an agent card expanded and open the kebab menu */
async function renderCardAndOpenKebab(agent: ReturnType<typeof makeAgent>) {
  useSidebarStore.setState({ expandedAgentIds: new Set(["agent-1"]) })

  render(
    React.createElement(AgentCardRow, { agent } as any),
    { wrapper: makeWrapper(standardMocks()) },
  )

  // Open the kebab menu
  const kebabButton = screen.getByTitle("Agent actions")
  fireEvent.click(kebabButton)

  // Wait for menu to appear
  await waitFor(() => {
    expect(screen.getByText("Redeploy")).toBeTruthy()
  })
}

/* ================================================================== */
/*  TESTS                                                               */
/* ================================================================== */

afterEach(() => {
  cleanup()
  useSidebarStore.setState({ expandedAgentIds: new Set() })
})

describe("control verb visibility: running agent", () => {
  it("shows Interrupt, Clear Session, Redeploy — no Restart", async () => {
    await renderCardAndOpenKebab(makeAgent({ lifecycleStatus: "running" }))

    expect(screen.getByText("Interrupt")).toBeTruthy()
    expect(screen.getByText("Clear Session")).toBeTruthy()
    expect(screen.getByText("Redeploy")).toBeTruthy()
    expect(screen.getByText("Report Incident")).toBeTruthy()
    expect(screen.getByText("Remove")).toBeTruthy()

    // No "Restart" label anywhere
    expect(screen.queryByText("Restart")).toBeNull()
    expect(screen.queryByText("Restart All")).toBeNull()
  })
})

describe("control verb visibility: idle agent", () => {
  it("shows Clear Session and Redeploy — no Interrupt, no Restart", async () => {
    await renderCardAndOpenKebab(makeAgent({ lifecycleStatus: "idle" }))

    expect(screen.getByText("Clear Session")).toBeTruthy()
    expect(screen.getByText("Redeploy")).toBeTruthy()
    expect(screen.getByText("Remove")).toBeTruthy()

    // Interrupt not available when idle
    expect(screen.queryByText("Interrupt")).toBeNull()
    // No Restart
    expect(screen.queryByText("Restart")).toBeNull()
  })
})

describe("control verb visibility: deploying agent", () => {
  it("shows Redeploy only — no Interrupt, no Clear Session, no Restart", async () => {
    await renderCardAndOpenKebab(makeAgent({ lifecycleStatus: "deploying" }))

    expect(screen.getByText("Redeploy")).toBeTruthy()
    expect(screen.getByText("Remove")).toBeTruthy()

    expect(screen.queryByText("Interrupt")).toBeNull()
    expect(screen.queryByText("Clear Session")).toBeNull()
    expect(screen.queryByText("Restart")).toBeNull()
  })
})

describe("control verb visibility: stopped agent", () => {
  it("shows Redeploy only — no Interrupt, no Clear Session, no Restart", async () => {
    await renderCardAndOpenKebab(makeAgent({ lifecycleStatus: "stopped" }))

    expect(screen.getByText("Redeploy")).toBeTruthy()
    expect(screen.getByText("Remove")).toBeTruthy()

    expect(screen.queryByText("Interrupt")).toBeNull()
    expect(screen.queryByText("Clear Session")).toBeNull()
    expect(screen.queryByText("Restart")).toBeNull()
  })
})

describe("control verb visibility: error agent", () => {
  it("shows Redeploy only — no Interrupt, no Clear Session, no Restart", async () => {
    await renderCardAndOpenKebab(makeAgent({ lifecycleStatus: "error" }))

    expect(screen.getByText("Redeploy")).toBeTruthy()
    expect(screen.getByText("Remove")).toBeTruthy()

    expect(screen.queryByText("Interrupt")).toBeNull()
    expect(screen.queryByText("Clear Session")).toBeNull()
    expect(screen.queryByText("Restart")).toBeNull()
  })
})

describe("canonical vocabulary: no Restart anywhere in rendered output", () => {
  it("full card render for running agent contains zero Restart text nodes", async () => {
    useSidebarStore.setState({ expandedAgentIds: new Set(["agent-1"]) })

    const { container } = render(
      React.createElement(AgentCardRow, { agent: makeAgent() } as any),
      { wrapper: makeWrapper(standardMocks()) },
    )

    // Open kebab to include all possible menu text
    const kebabButton = screen.getByTitle("Agent actions")
    fireEvent.click(kebabButton)

    await waitFor(() => {
      expect(screen.getByText("Redeploy")).toBeTruthy()
    })

    // Search the entire rendered output for "Restart"
    const allText = container.textContent ?? ""
    expect(allText).not.toContain("Restart")
  })
})
