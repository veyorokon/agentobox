/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest"

import { classifyProjectWsClose } from "@/lib/hooks/use-project-ws"


describe("classifyProjectWsClose", () => {
  it("treats 4001 as stale or invalid auth", () => {
    expect(classifyProjectWsClose(4001)).toBe("clear_auth")
  })

  it("treats 4005 as forbidden without clearing auth", () => {
    expect(classifyProjectWsClose(4005)).toBe("forbidden")
  })

  it("reconnects on non-auth close codes", () => {
    expect(classifyProjectWsClose(1006)).toBe("reconnect")
    expect(classifyProjectWsClose(1011)).toBe("reconnect")
  })
})
