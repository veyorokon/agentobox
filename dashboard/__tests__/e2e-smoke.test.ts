/**
 * E2E smoke / contract tests.
 *
 * Lightweight HTTP-level tests that verify the GraphQL endpoint returns
 * the expected response shapes. Uses raw fetch() (no Apollo) to match
 * how the login page works.
 *
 * These tests require the backend to be running at localhost:8000.
 * Skip with: SKIP_E2E=1 npx vitest run
 */

import { describe, it, expect, beforeAll } from "vitest"

/* ── Config ──────────────────────────────────────────────────────── */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/graphql"
const TEST_USER = "demo"
const TEST_PASS = "demo"
const SKIP = process.env.SKIP_E2E === "1"

/* ── Helpers ─────────────────────────────────────────────────────── */

async function gql(query: string, variables?: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  })
  return res.json()
}

/** Check if the backend is reachable before running the suite. */
async function backendIsUp(): Promise<boolean> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/* ================================================================== */
/*  Contract Tests                                                      */
/* ================================================================== */

describe.skipIf(SKIP)("E2E Smoke Tests (requires backend)", () => {
  let isUp = false
  let authToken: string | undefined

  beforeAll(async () => {
    isUp = await backendIsUp()
    if (!isUp) {
      console.warn(
        "[e2e-smoke] Backend not reachable at %s — skipping all e2e tests. " +
        "Start with: docker compose up -d",
        API_URL,
      )
    }
  })

  /* ── Login contract ──────────────────────────────────────────── */

  describe("login mutation", () => {
    it("returns token and user shape on valid credentials", async (ctx) => {
      if (!isUp) return ctx.skip()

      const json = await gql(
        `mutation Login($input: LoginInput!) {
          login(input: $input) {
            token
            user { id username }
          }
        }`,
        { input: { username: TEST_USER, password: TEST_PASS } },
      )

      expect(json.errors).toBeUndefined()
      expect(json.data.login).toBeDefined()
      expect(typeof json.data.login.token).toBe("string")
      expect(json.data.login.token.length).toBeGreaterThan(0)
      expect(json.data.login.user).toBeDefined()
      expect(typeof json.data.login.user.id).toBe("string")
      expect(json.data.login.user.username).toBe(TEST_USER)

      // Save for downstream tests
      authToken = json.data.login.token
    })

    it("returns error on invalid credentials", async (ctx) => {
      if (!isUp) return ctx.skip()

      const json = await gql(
        `mutation Login($input: LoginInput!) {
          login(input: $input) {
            token
            user { id username }
          }
        }`,
        { input: { username: "nonexistent", password: "wrongpassword" } },
      )

      // Backend should return either GraphQL errors or a null result
      const hasError = json.errors?.length > 0 || json.data?.login === null
      expect(hasError).toBe(true)
    })
  })

  /* ── Agents query contract ───────────────────────────────────── */

  describe("agents query", () => {
    it("returns an array with expected field shapes when authenticated", async (ctx) => {
      if (!isUp) return ctx.skip()

      // Ensure we have a token (login test may have run first, but be safe)
      if (!authToken) {
        const loginJson = await gql(
          `mutation Login($input: LoginInput!) {
            login(input: $input) { token }
          }`,
          { input: { username: TEST_USER, password: TEST_PASS } },
        )
        authToken = loginJson.data?.login?.token
        if (!authToken) return ctx.skip()
      }

      // We need a projectId — query projects first
      const projectsJson = await gql(
        `{ projects { id name } }`,
        undefined,
        authToken,
      )

      // If no projects exist, skip (test env may be empty)
      const projects = projectsJson.data?.projects
      if (!projects || projects.length === 0) {
        console.warn("[e2e-smoke] No projects found — skipping agents contract test")
        return ctx.skip()
      }

      const projectId = projects[0].id
      const json = await gql(
        `query GetAgents($projectId: ID!) {
          agents(projectId: $projectId) {
            id
            name
            lifecycleStatus
            attentionLevel
            mode
            task
            cost
            duration
            model
            turns
          }
        }`,
        { projectId },
        authToken,
      )

      expect(json.errors).toBeUndefined()
      expect(Array.isArray(json.data.agents)).toBe(true)

      // If agents exist, validate the field shape
      if (json.data.agents.length > 0) {
        const agent = json.data.agents[0]
        expect(typeof agent.id).toBe("string")
        expect(typeof agent.name).toBe("string")
        expect(typeof agent.lifecycleStatus).toBe("string")
        expect(typeof agent.attentionLevel).toBe("string")
        expect(typeof agent.mode).toBe("string")
        expect(typeof agent.cost).toBe("number")
        expect(typeof agent.turns).toBe("number")
      }
    })

    it("rejects unauthenticated requests", async (ctx) => {
      if (!isUp) return ctx.skip()

      // Try to query agents without a token — should fail
      const json = await gql(
        `query GetAgents($projectId: ID!) {
          agents(projectId: $projectId) { id name }
        }`,
        { projectId: "fake-id" },
        // no token
      )

      // Backend should return errors for unauthenticated requests
      const hasError = json.errors?.length > 0 || json.data?.agents === null
      expect(hasError).toBe(true)
    })
  })

  /* ── Feed query contract ─────────────────────────────────────── */

  describe("feed query", () => {
    it("returns an array with expected field shapes when authenticated", async (ctx) => {
      if (!isUp) return ctx.skip()

      if (!authToken) {
        const loginJson = await gql(
          `mutation Login($input: LoginInput!) {
            login(input: $input) { token }
          }`,
          { input: { username: TEST_USER, password: TEST_PASS } },
        )
        authToken = loginJson.data?.login?.token
        if (!authToken) return ctx.skip()
      }

      const projectsJson = await gql(
        `{ projects { id } }`,
        undefined,
        authToken,
      )
      const projects = projectsJson.data?.projects
      if (!projects || projects.length === 0) return ctx.skip()

      const projectId = projects[0].id
      const json = await gql(
        `query GetFeed($projectId: ID!) {
          teamFeed(projectId: $projectId) {
            id
            type
            agent
            text
            permStatus
            planStatus
          }
        }`,
        { projectId },
        authToken,
      )

      expect(json.errors).toBeUndefined()
      expect(Array.isArray(json.data.teamFeed)).toBe(true)

      // If feed items exist, validate shape
      if (json.data.teamFeed.length > 0) {
        const item = json.data.teamFeed[0]
        expect(typeof item.id).toBe("string")
        expect(typeof item.type).toBe("string")
      }
    })
  })
})
