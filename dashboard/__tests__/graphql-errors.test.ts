/**
 * GraphQL error presentation contract.
 *
 * Keeps backend timeout/network failures mapped to explicit user-facing copy
 * instead of indefinite loading states.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest"

import { describeGraphqlError } from "@/lib/graphql/errors"

describe("describeGraphqlError", () => {
  it("maps timeout-shaped failures to a backend timeout message", () => {
    expect(describeGraphqlError(new Error("GraphQL request timed out after 15000ms"))).toBe(
      "Backend timed out. Retry in a moment.",
    )
  })

  it("falls back to the original error message when it is already specific", () => {
    expect(describeGraphqlError(new Error("Project lookup failed"))).toBe("Project lookup failed")
  })
})
