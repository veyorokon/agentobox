/**
 * Error banner state regression.
 *
 * The project page error banner must clear automatically when data loads
 * successfully. Apollo can retain a stale `error` object even after a
 * successful refetch or WebSocket snapshot, so the banner condition must
 * check for data presence, not just error absence.
 *
 * Bug: #108 — banner persisted after data loaded.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest"

/**
 * Mirrors the backendError derivation from app/p/[projectId]/page.tsx.
 * Extracted here so the test doesn't need to render the full page.
 */
function deriveBackendError({
  projectData,
  projectError,
  agentsData,
  agentsError,
  providers,
  providerError,
}: {
  projectData: { project: object | null } | undefined
  projectError: Error | undefined
  agentsData: { agents: object[] } | undefined
  agentsError: Error | undefined
  providers: object[]
  providerError: Error | undefined
}): Error | null {
  const hasProjectData = Boolean(projectData?.project)
  const hasAgentData = Boolean(agentsData?.agents)
  return (
    (!hasProjectData && projectError)
    || (!hasAgentData && agentsError)
    || null
  ) as Error | null
}

const mockError = new Error("Network error")

describe("Project error banner state", () => {
  it("shows error when query fails and no data exists", () => {
    const result = deriveBackendError({
      projectData: undefined,
      projectError: mockError,
      agentsData: undefined,
      agentsError: undefined,
      providers: [],
      providerError: undefined,
    })
    expect(result).toBeTruthy()
  })

  it("clears error when project data loads after initial failure", () => {
    const result = deriveBackendError({
      projectData: { project: { id: "p1", name: "Test" } },
      projectError: mockError, // stale error still present
      agentsData: { agents: [{ id: "a1" }] },
      agentsError: undefined,
      providers: [{ slug: "anthropic", configured: true }],
      providerError: undefined,
    })
    expect(result).toBeNull()
  })

  it("clears error when agents data loads after initial failure", () => {
    const result = deriveBackendError({
      projectData: { project: { id: "p1", name: "Test" } },
      projectError: undefined,
      agentsData: { agents: [] }, // empty but present
      agentsError: mockError, // stale error
      providers: [{ slug: "anthropic", configured: true }],
      providerError: undefined,
    })
    expect(result).toBeNull()
  })

  it("clears error when provider data loads after initial failure", () => {
    const result = deriveBackendError({
      projectData: { project: { id: "p1", name: "Test" } },
      projectError: undefined,
      agentsData: { agents: [] },
      agentsError: undefined,
      providers: [{ slug: "anthropic", configured: true }],
      providerError: mockError, // stale error
    })
    expect(result).toBeNull()
  })

  it("does not block the page when provider status fails but core data loads", () => {
    const result = deriveBackendError({
      projectData: { project: { id: "p1", name: "Test" } },
      projectError: undefined,
      agentsData: { agents: [{ id: "a1" }] },
      agentsError: undefined,
      providers: [],
      providerError: mockError,
    })
    expect(result).toBeNull()
  })

  it("shows error when agents fail and no agent data exists", () => {
    const result = deriveBackendError({
      projectData: { project: { id: "p1", name: "Test" } },
      projectError: undefined,
      agentsData: undefined,
      agentsError: mockError,
      providers: [{ slug: "anthropic", configured: true }],
      providerError: undefined,
    })
    expect(result).toBeTruthy()
  })

  it("handles loading -> error -> retry -> success (all data arrives)", () => {
    // Step 1: error state
    const errorState = deriveBackendError({
      projectData: undefined,
      projectError: mockError,
      agentsData: undefined,
      agentsError: mockError,
      providers: [],
      providerError: mockError,
    })
    expect(errorState).toBeTruthy()

    // Step 2: retry succeeds — data arrives, stale errors remain
    const successState = deriveBackendError({
      projectData: { project: { id: "p1", name: "Test" } },
      projectError: mockError, // still set by Apollo
      agentsData: { agents: [{ id: "a1" }] },
      agentsError: mockError, // still set by Apollo
      providers: [{ slug: "anthropic", configured: true }],
      providerError: mockError, // still set by Apollo
    })
    expect(successState).toBeNull()
  })
})
