/**
 * @vitest-environment jsdom
 */

import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { GdaOverview } from "@/lib/graphql/hooks/use-gda"

type HookResult = {
  data: {
    project: {
      id: string
      name: string
      gdaOverview: GdaOverview | null
    } | null
  }
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

let hookResult: HookResult

vi.mock("@/lib/graphql/hooks/use-gda", () => ({
  useProjectGdaOverview: () => hookResult,
}))

const { GdaLiveBoard } = await import("@/components/gda/live-board")

function buildOverview(): GdaOverview {
  return {
    contextVersionId: "v1",
    subjectRef: "project://p1",
    subjectName: "gda-file-demo",
    worldRef: "world://demo",
    objective: {
      objectiveId: "objective-1",
      name: "Create hello file",
      description: "Write hello.txt",
    },
    awareness: {
      controlStatus: "running",
      stateEntryCount: 0,
      activeCommitmentCount: 1,
      recentObservationCount: 0,
      lastObservedAt: null,
    },
    progress: {
      objectiveId: "objective-1",
      status: "unknown",
      totalGoals: 2,
      satisfiedGoals: 0,
      unknownGoals: 2,
      failedGoals: 0,
      goalProgress: [
        {
          goalId: "goal-1",
          goalName: "hello exists",
          status: "unknown",
          missingDimensions: ["workspace.file.exists"],
          failedDimensions: [],
        },
      ],
    },
    activeCommitments: [
      {
        commitmentId: "commitment-file-1",
        capabilityId: "workspace.write_file",
        status: "active",
        objectiveId: "objective-1",
        assignmentAgentRef: "agent://worker",
        assignmentAgentName: "worker-agent",
      },
    ],
    recentObservations: [],
    recentExecutions: [],
    stateEntries: [],
  }
}

describe("GdaLiveBoard", () => {
  beforeEach(() => {
    hookResult = {
      data: {
        project: {
          id: "p1",
          name: "gda-file-demo",
          gdaOverview: buildOverview(),
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(async () => {}),
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("does not recurse when the overview object identity changes without a new context version", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const view = render(React.createElement(GdaLiveBoard, { projectId: "p1" }))

    hookResult = {
      ...hookResult,
      data: {
        project: {
          id: "p1",
          name: "gda-file-demo",
          gdaOverview: buildOverview(),
        },
      },
    }

    view.rerender(React.createElement(GdaLiveBoard, { projectId: "p1" }))

    expect(screen.getByText("gda-file-demo · Create hello file")).toBeTruthy()
    expect(consoleError.mock.calls.flat().join("\n")).not.toContain("Maximum update depth exceeded")
  })
})
