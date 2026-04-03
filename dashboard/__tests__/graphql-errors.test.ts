/**
 * GraphQL error presentation contract.
 *
 * Keeps backend timeout/network failures mapped to explicit user-facing copy
 * instead of indefinite loading states.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest"

import {
  classifyProjectPageError,
  describeGraphqlError,
  getProjectPageErrorPresentation,
  isAuthGraphqlError,
} from "@/lib/graphql/errors"

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

describe("isAuthGraphqlError", () => {
  it("detects graphql payload auth failures", () => {
    expect(isAuthGraphqlError({ errors: [{ message: "Authentication required" }] })).toBe(true)
  })

  it("does not classify generic backend failures as auth failures", () => {
    expect(isAuthGraphqlError(new Error("Project lookup failed"))).toBe(false)
  })
})

describe("project page error classification", () => {
  it("classifies ownership-shaped project misses as forbidden", () => {
    expect(classifyProjectPageError(new Error("Project matching query does not exist."))).toBe("forbidden")
  })

  it("maps forbidden project errors to an access-denied banner", () => {
    expect(getProjectPageErrorPresentation(new Error("Project matching query does not exist."))).toEqual({
      title: "You do not have access to this project",
      detail: "Project matching query does not exist.",
    })
  })

  it("keeps timeout-shaped failures as temporary backend issues", () => {
    expect(getProjectPageErrorPresentation(new Error("GraphQL request timed out after 15000ms"))).toEqual({
      title: "Project data is temporarily unavailable",
      detail: "Backend timed out. Retry in a moment.",
    })
  })
})
