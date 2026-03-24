// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import { focusTerminalInput } from "@/components/workbench/terminal-workbench-prototype"
import {
  buildInitialWorkbenchWindows,
  gridWindowHeight,
  gridWindowWidth,
  normalizeRequestedAgentIds,
  WORKBENCH_MINIMIZED_HEIGHT,
  WORKBENCH_TITLEBAR_HEIGHT,
} from "@/components/workbench/workbench-layout"

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

  it("uses one shared titlebar height for minimized and grid window sizing", () => {
    expect(WORKBENCH_MINIMIZED_HEIGHT).toBe(WORKBENCH_TITLEBAR_HEIGHT)
    expect(gridWindowHeight(7, 20)).toBe(WORKBENCH_TITLEBAR_HEIGHT + 140)
  })

  it("computes snapped window width from terminal columns", () => {
    expect(gridWindowWidth(80, 9)).toBe(720)
  })

  it("focuses the hidden terminal textarea when present", () => {
    const root = document.createElement("div")
    const textarea = document.createElement("textarea")
    root.appendChild(textarea)
    document.body.appendChild(root)

    expect(focusTerminalInput(root)).toBe(true)
    expect(document.activeElement).toBe(textarea)

    root.remove()
  })
})
