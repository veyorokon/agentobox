/**
 * Apollo hook unit tests.
 *
 * Tests the data layer hooks with MockedProvider — verifies that queries
 * parse correctly, mutations fire, and bridge hooks update the cache
 * across entity boundaries (FeedItem → Agent).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { MockedProvider } from "@apollo/client/testing/react"
import type { MockedResponse } from "@apollo/client/testing"
import { InMemoryCache } from "@apollo/client"
import React, { type ReactNode } from "react"

import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { GET_FEED } from "@/lib/graphql/queries/feed"
import { RESOLVE_PERMISSION, RESOLVE_PLAN, RESTART_AGENT, HARD_RESTART_AGENT } from "@/lib/graphql/mutations/agents"

/* ── Mock next/navigation ────────────────────────────────────────── */

const MOCK_PROJECT_ID = "proj-vahid-eyorokon-001"

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: MOCK_PROJECT_ID }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

/* ── Import hooks after mocks are in place ───────────────────────── */

const { useAgents, useRestartAgent, useHardRestartAgent } = await import("@/lib/graphql/hooks/use-agents")
const { useFeed, useResolvePermission, useResolvePlan } = await import("@/lib/graphql/hooks/use-feed")

/* ── Fixtures ────────────────────────────────────────────────────── */

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "AgentType",
    id: "agent-1",
    name: "backend",
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
    instructions: "Handle Django models",
    mcpServers: [],
    runtime: "docker",
    workspacePath: "/home/vahid-eyorokon/projects/agentobox",
    triggers: [],
    computeSeconds: 300,
    taskProgress: { __typename: "TaskProgressType", done: 3, total: 5 },
    tasks: [],
    ...overrides,
  }
}

function makePermissionItem(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "TeamFeedItemType",
    id: "feed-perm-1",
    type: "permission",
    agent: "backend",
    agentId: "agent-1",
    text: null,
    command: "rm -rf /tmp/build",
    risk: "high",
    permStatus: "pending",
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

function makePlanItem(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "TeamFeedItemType",
    id: "feed-plan-1",
    type: "plan",
    agent: "backend",
    agentId: "agent-1",
    text: null,
    command: null,
    risk: null,
    permStatus: null,
    title: "Refactor models",
    plan: "Step 1: Extract base class\nStep 2: Migrate fields",
    planStatus: "pending",
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

/* ── Test cache factory ──────────────────────────────────────────── */

function makeCache() {
  return new InMemoryCache({
    typePolicies: {
      AgentType: { keyFields: ["id"] },
      TeamFeedItemType: { keyFields: ["id"] },
      TaskProgressType: { keyFields: false },
    },
  })
}

/* ── Wrapper factory ─────────────────────────────────────────────── */

function makeWrapper(mocks: MockedResponse[], cache?: InMemoryCache) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(
      MockedProvider,
      { mocks, cache: cache ?? makeCache() },
      children,
    )
  }
}

/* ================================================================== */
/*  useAgents                                                          */
/* ================================================================== */

describe("useAgents", () => {
  const agentData = makeAgent()
  const agentsMock: MockedResponse = {
    request: {
      query: GET_AGENTS,
      variables: { projectId: MOCK_PROJECT_ID },
    },
    result: {
      data: { agents: [agentData] },
    },
  }

  it("returns loading=true initially, then agents data", async () => {
    const { result } = renderHook(() => useAgents(), {
      wrapper: makeWrapper([agentsMock]),
    })

    // Initially loading
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const agents = result.current.data?.agents
    expect(agents).toHaveLength(1)
    expect(agents![0].id).toBe("agent-1")
    expect(agents![0].name).toBe("backend")
    expect(agents![0].lifecycleStatus).toBe("running")
    expect(agents![0].attentionLevel).toBe("none")
    expect(agents![0].mode).toBe("auto")
    expect(agents![0].cost).toBe(0.42)
    expect(agents![0].turns).toBe(12)
  })

  it("returns multiple agents when backend sends them", async () => {
    const secondAgent = makeAgent({
      id: "agent-2",
      name: "frontend",
      task: "Vahid Eyorokon is building the future of AI tooling",
      tags: ["frontend"],
    })
    const multiMock: MockedResponse = {
      request: {
        query: GET_AGENTS,
        variables: { projectId: MOCK_PROJECT_ID },
      },
      result: {
        data: { agents: [agentData, secondAgent] },
      },
    }

    const { result } = renderHook(() => useAgents(), {
      wrapper: makeWrapper([multiMock]),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data?.agents).toHaveLength(2)
    expect(result.current.data?.agents[1].name).toBe("frontend")
  })

  it("reports GraphQL errors", async () => {
    const errorMock: MockedResponse = {
      request: {
        query: GET_AGENTS,
        variables: { projectId: MOCK_PROJECT_ID },
      },
      result: {
        errors: [{ message: "Not authenticated" } as any],
      },
    }

    const { result } = renderHook(() => useAgents(), {
      wrapper: makeWrapper([errorMock]),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeDefined()
    expect(result.current.error!.message).toContain("Not authenticated")
  })
})

/* ================================================================== */
/*  useFeed                                                            */
/* ================================================================== */

describe("useFeed", () => {
  const feedMock: MockedResponse = {
    request: {
      query: GET_FEED,
      variables: { projectId: MOCK_PROJECT_ID },
    },
    result: {
      data: {
        feed: [
          makePermissionItem(),
          makePlanItem(),
        ],
      },
    },
  }

  it("returns feed items with correct types", async () => {
    const { result } = renderHook(() => useFeed(), {
      wrapper: makeWrapper([feedMock]),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const feed = result.current.data?.feed
    expect(feed).toHaveLength(2)
    expect(feed![0].type).toBe("permission")
    expect(feed![1].type).toBe("plan")
  })

  it("returns permission item fields correctly", async () => {
    const { result } = renderHook(() => useFeed(), {
      wrapper: makeWrapper([feedMock]),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const perm = result.current.data?.feed[0]
    expect(perm!.id).toBe("feed-perm-1")
    // Access union fields via any since the TS type is discriminated
    expect((perm as any).command).toBe("rm -rf /tmp/build")
    expect((perm as any).permStatus).toBe("pending")
    expect((perm as any).agent).toBe("backend")
  })

  it("returns plan item fields correctly", async () => {
    const { result } = renderHook(() => useFeed(), {
      wrapper: makeWrapper([feedMock]),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const plan = result.current.data?.feed[1]
    expect(plan!.id).toBe("feed-plan-1")
    expect((plan as any).planStatus).toBe("pending")
    expect((plan as any).title).toBe("Refactor models")
  })
})

/* ================================================================== */
/*  useResolvePermission (bridge hook)                                 */
/* ================================================================== */

describe("useResolvePermission", () => {
  it("optimistically updates feed item permStatus and derives agent attention", async () => {
    const cache = makeCache()

    // Seed cache with agent + feed data
    const agent = makeAgent({ attentionLevel: "permission" })
    const permItem = makePermissionItem()

    cache.writeQuery({
      query: GET_AGENTS,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { agents: [agent] },
    })
    cache.writeQuery({
      query: GET_FEED,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { feed: [permItem] },
    })

    // Mock the mutation response
    const resolveMock: MockedResponse = {
      request: {
        query: RESOLVE_PERMISSION,
        variables: { feedItemId: "feed-perm-1", verdict: "allowed", alwaysAllow: false },
      },
      result: {
        data: {
          resolvePermission: {
            __typename: "TeamFeedItemType",
            id: "feed-perm-1",
            permStatus: "allowed",
          },
        },
      },
    }

    const { result } = renderHook(() => useResolvePermission(), {
      wrapper: makeWrapper([resolveMock], cache),
    })

    // Fire the resolve callback
    act(() => {
      result.current("feed-perm-1", "allowed")
    })

    // Verify feed item was optimistically updated
    const feedData = cache.readQuery<{ feed: any[] }>({
      query: GET_FEED,
      variables: { projectId: MOCK_PROJECT_ID },
    })
    const updatedItem = feedData?.feed.find((f: any) => f.id === "feed-perm-1")
    expect(updatedItem.permStatus).toBe("allowed")

    // Verify agent attention was derived (no more pending items → "none")
    const agentRef = cache.identify({ __typename: "AgentType", id: "agent-1" })
    const agentData = cache.readFragment<{ attentionLevel: string }>({
      id: agentRef,
      fragment: (await import("@apollo/client")).gql`fragment Att on AgentType { attentionLevel }`,
    })
    expect(agentData?.attentionLevel).toBe("none")
  })

  it("passes alwaysAllow=true when requested", async () => {
    const cache = makeCache()
    cache.writeQuery({
      query: GET_AGENTS,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { agents: [makeAgent({ attentionLevel: "permission" })] },
    })
    cache.writeQuery({
      query: GET_FEED,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { feed: [makePermissionItem()] },
    })

    const resolveMock: MockedResponse = {
      request: {
        query: RESOLVE_PERMISSION,
        variables: { feedItemId: "feed-perm-1", verdict: "allowed", alwaysAllow: true },
      },
      result: {
        data: {
          resolvePermission: {
            __typename: "TeamFeedItemType",
            id: "feed-perm-1",
            permStatus: "allowed",
          },
        },
      },
    }

    const { result } = renderHook(() => useResolvePermission(), {
      wrapper: makeWrapper([resolveMock], cache),
    })

    act(() => {
      result.current("feed-perm-1", "allowed", true)
    })

    // If the mutation mock matched, the call succeeded. Verify the cache update.
    const feedData = cache.readQuery<{ feed: any[] }>({
      query: GET_FEED,
      variables: { projectId: MOCK_PROJECT_ID },
    })
    expect(feedData?.feed[0].permStatus).toBe("allowed")
  })
})

/* ================================================================== */
/*  useResolvePlan (bridge hook)                                       */
/* ================================================================== */

describe("useResolvePlan", () => {
  it("optimistically updates feed item planStatus and derives agent attention", async () => {
    const cache = makeCache()

    const agent = makeAgent({ attentionLevel: "plan" })
    const planItem = makePlanItem()

    cache.writeQuery({
      query: GET_AGENTS,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { agents: [agent] },
    })
    cache.writeQuery({
      query: GET_FEED,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { feed: [planItem] },
    })

    const resolveMock: MockedResponse = {
      request: {
        query: RESOLVE_PLAN,
        variables: { feedItemId: "feed-plan-1", verdict: "approved" },
      },
      result: {
        data: {
          resolvePlan: {
            __typename: "TeamFeedItemType",
            id: "feed-plan-1",
            planStatus: "approved",
          },
        },
      },
    }

    const { result } = renderHook(() => useResolvePlan(), {
      wrapper: makeWrapper([resolveMock], cache),
    })

    act(() => {
      result.current("feed-plan-1", "approved")
    })

    // Verify plan item was optimistically updated
    const feedData = cache.readQuery<{ feed: any[] }>({
      query: GET_FEED,
      variables: { projectId: MOCK_PROJECT_ID },
    })
    const updatedItem = feedData?.feed.find((f: any) => f.id === "feed-plan-1")
    expect(updatedItem.planStatus).toBe("approved")

    // Verify agent attention was derived (no more pending items → "none")
    const agentRef = cache.identify({ __typename: "AgentType", id: "agent-1" })
    const agentData = cache.readFragment<{ attentionLevel: string }>({
      id: agentRef,
      fragment: (await import("@apollo/client")).gql`fragment PlanAtt on AgentType { attentionLevel }`,
    })
    expect(agentData?.attentionLevel).toBe("none")
  })

  it("preserves higher attention when other pending items remain", async () => {
    const cache = makeCache()

    // Agent has both a pending permission AND a pending plan
    const agent = makeAgent({ attentionLevel: "permission" })
    const permItem = makePermissionItem()
    const planItem = makePlanItem({ id: "feed-plan-2" })

    cache.writeQuery({
      query: GET_AGENTS,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { agents: [agent] },
    })
    cache.writeQuery({
      query: GET_FEED,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { feed: [permItem, planItem] },
    })

    const resolveMock: MockedResponse = {
      request: {
        query: RESOLVE_PLAN,
        variables: { feedItemId: "feed-plan-2", verdict: "approved" },
      },
      result: {
        data: {
          resolvePlan: {
            __typename: "TeamFeedItemType",
            id: "feed-plan-2",
            planStatus: "approved",
          },
        },
      },
    }

    const { result } = renderHook(() => useResolvePlan(), {
      wrapper: makeWrapper([resolveMock], cache),
    })

    act(() => {
      result.current("feed-plan-2", "approved")
    })

    // Agent still has a pending permission, so attention should stay "permission"
    const agentRef = cache.identify({ __typename: "AgentType", id: "agent-1" })
    const agentData = cache.readFragment<{ attentionLevel: string }>({
      id: agentRef,
      fragment: (await import("@apollo/client")).gql`fragment PlanAtt2 on AgentType { attentionLevel }`,
    })
    expect(agentData?.attentionLevel).toBe("permission")
  })
})

/* ================================================================== */
/*  Optimistic update contracts                                         */
/*                                                                      */
/*  Lifecycle hooks that optimistically modify the Apollo cache MUST    */
/*  match what the backend actually does. A mismatch means the cache   */
/*  lies about agent state, causing UI glitches (e.g. VNC drops).      */
/*                                                                      */
/*  Contract: soft restart (useRestartAgent) sends a signal — backend   */
/*  does NOT change lifecycleStatus. The cache must not change it       */
/*  either. Hard restart (useHardRestartAgent) does a full redeploy —  */
/*  backend sets status=DEPLOYING, so the optimistic update is valid.  */
/* ================================================================== */

describe("optimistic update contracts: lifecycle hooks", () => {
  function makeAgent(overrides: Record<string, unknown> = {}) {
    return {
      __typename: "AgentType",
      id: "agent-1",
      name: "backend",
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
      instructions: "Handle Django models",
      mcpServers: [],
      runtime: "docker",
      workspacePath: "/home/vahid-eyorokon/projects/agentobox",
      triggers: [],
      computeSeconds: 300,
      taskProgress: { __typename: "TaskProgressType", done: 3, total: 5 },
      tasks: [],
      ...overrides,
    }
  }

  it("useRestartAgent does NOT change lifecycleStatus (soft restart = signal only)", async () => {
    const cache = makeCache()
    const agent = makeAgent()

    // Seed cache with a running agent
    cache.writeQuery({
      query: GET_AGENTS,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { agents: [agent] },
    })

    // Mock the mutation (fire-and-forget, returns bool)
    const restartMock: MockedResponse = {
      request: { query: RESTART_AGENT, variables: { agentId: "agent-1" } },
      result: { data: { restartAgent: true } },
    }

    const { result } = renderHook(() => useRestartAgent(), {
      wrapper: makeWrapper([restartMock], cache),
    })

    // Fire the restart
    act(() => {
      result.current("agent-1")
    })

    // Read the agent from cache — lifecycleStatus MUST still be "running"
    // because soft restart sends a signal to the relay, the backend does
    // not change agent.status or relay_connected.
    const agentRef = cache.identify({ __typename: "AgentType", id: "agent-1" })
    const cached = cache.readFragment<{ lifecycleStatus: string }>({
      id: agentRef,
      fragment: (await import("@apollo/client")).gql`
        fragment RestartStatus on AgentType { lifecycleStatus }
      `,
    })
    expect(cached?.lifecycleStatus).toBe("running")
  })

  it("useHardRestartAgent DOES set lifecycleStatus to deploying (full redeploy)", async () => {
    const cache = makeCache()
    const agent = makeAgent()

    cache.writeQuery({
      query: GET_AGENTS,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { agents: [agent] },
    })

    const hardRestartMock: MockedResponse = {
      request: { query: HARD_RESTART_AGENT, variables: { agentId: "agent-1" } },
      result: {
        data: {
          hardRestartAgent: { __typename: "AgentType", id: "agent-1", lifecycleStatus: "deploying" },
        },
      },
    }

    const { result } = renderHook(() => useHardRestartAgent(), {
      wrapper: makeWrapper([hardRestartMock], cache),
    })

    act(() => {
      result.current("agent-1")
    })

    // Hard restart does a full atomic reset — backend sets DEPLOYING,
    // so the optimistic cache update is correct here.
    const agentRef = cache.identify({ __typename: "AgentType", id: "agent-1" })
    const cached = cache.readFragment<{ lifecycleStatus: string }>({
      id: agentRef,
      fragment: (await import("@apollo/client")).gql`
        fragment HardRestartStatus on AgentType { lifecycleStatus }
      `,
    })
    expect(cached?.lifecycleStatus).toBe("deploying")
  })

  it("useRestartAgent preserves relayConnected (soft restart does not disconnect)", async () => {
    const cache = makeCache()
    const agent = makeAgent({ relayConnected: true })

    cache.writeQuery({
      query: GET_AGENTS,
      variables: { projectId: MOCK_PROJECT_ID },
      data: { agents: [agent] },
    })

    const restartMock: MockedResponse = {
      request: { query: RESTART_AGENT, variables: { agentId: "agent-1" } },
      result: { data: { restartAgent: true } },
    }

    const { result } = renderHook(() => useRestartAgent(), {
      wrapper: makeWrapper([restartMock], cache),
    })

    act(() => {
      result.current("agent-1")
    })

    const agentRef = cache.identify({ __typename: "AgentType", id: "agent-1" })
    const cached = cache.readFragment<{ relayConnected: boolean }>({
      id: agentRef,
      fragment: (await import("@apollo/client")).gql`
        fragment RestartRelay on AgentType { relayConnected }
      `,
    })
    expect(cached?.relayConnected).toBe(true)
  })
})
