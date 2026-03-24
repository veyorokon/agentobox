import { describe, expect, it } from "vitest"

import { buildInitialWorkbenchWindows, normalizeRequestedAgentIds } from "@/components/workbench/workbench-layout"

describe("workbench agent selection", () => {
  it("normalizes repeated and comma-separated agent ids", () => {
    expect(normalizeRequestedAgentIds(["a1", "a2,a3", "a2", " a4 ", ""])).toEqual(["a1", "a2", "a3", "a4"])
  })

  it("opens only explicitly requested agents", () => {
    const windows = buildInitialWorkbenchWindows(
      [
        { id: "a1", name: "team-lead" },
        { id: "a2", name: "builder" },
        { id: "a3", name: "qa" },
      ],
      ["a3", "a1"],
    )

    expect(windows.map(window => window.agentId)).toEqual(["a3", "a1"])
  })

  it("does not seed demo windows when no agent ids are requested", () => {
    const windows = buildInitialWorkbenchWindows(
      [{ id: "a1", name: "team-lead" }],
      [],
    )

    expect(windows).toEqual([])
  })
})
