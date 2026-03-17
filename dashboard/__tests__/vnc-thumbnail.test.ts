/**
 * @vitest-environment jsdom
 */

import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Agent } from "@/lib/types"

const createVncToken = vi.fn()
const hardRestartAgent = vi.fn()
const disconnectSpy = vi.fn()
const connectSpy = vi.fn()
const screenProps: any[] = []

vi.mock("@apollo/client/react", () => ({
  useMutation: () => [createVncToken],
}))

vi.mock("@/lib/graphql/hooks/use-agents", () => ({
  useHardRestartAgent: () => hardRestartAgent,
}))

vi.mock("react-vnc", () => ({
  VncScreen: React.forwardRef(function VncScreenMock(props: any, ref) {
    screenProps.push(props)
    React.useImperativeHandle(ref, () => ({
      connect: vi.fn(() => {
        connectSpy()
        props.onConnect?.()
      }),
      disconnect: disconnectSpy,
    }))
    return React.createElement("div", {
      "data-testid": "vnc-screen",
      "data-url": props.url,
      "data-has-resize-session": String(Boolean(props.resizeSession)),
    })
  }),
}))

const { VncThumbnail } = await import("@/components/agent/vnc-thumbnail")

const baseAgent: Agent = {
  id: "agent-1",
  name: "team-lead",
  lifecycleStatus: "idle",
  attentionLevel: "none",
  relayConnected: true,
  task: "idle",
  cost: 0,
  duration: "1m",
  model: "claude-haiku",
  turns: 0,
  lastOutput: "",
  triggers: null,
  computeSeconds: 0,
  instructions: "",
  mcpServers: [],
  runtime: "docker",
  workspacePath: "/workspace",
  tags: [],
  mode: "auto",
  tasks: [],
}

describe("VncThumbnail", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    createVncToken.mockReset()
    disconnectSpy.mockReset()
    connectSpy.mockReset()
    hardRestartAgent.mockReset()
    screenProps.length = 0
    createVncToken.mockResolvedValue({
      data: { createVncToken: { token: "test-token" } },
    })
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal("cancelAnimationFrame", () => {})
  })

  afterEach(() => {
    cleanup()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("keeps the VNC viewer mounted across transient container-state flickers", async () => {
    const { rerender } = render(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())
    expect(createVncToken).toHaveBeenCalledTimes(1)

    rerender(React.createElement(VncThumbnail, { agent: { ...baseAgent, relayConnected: false } }))
    expect(screen.getByTestId("vnc-screen")).toBeTruthy()

    vi.advanceTimersByTime(3000)
    expect(screen.getByTestId("vnc-screen")).toBeTruthy()

    rerender(React.createElement(VncThumbnail, { agent: baseAgent }))

    expect(screen.getByTestId("vnc-screen")).toBeTruthy()
    expect(disconnectSpy).not.toHaveBeenCalled()
  })

  it("reuses the current VNC URL on transient disconnects instead of minting a new token", async () => {
    render(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())
    expect(createVncToken).toHaveBeenCalledTimes(1)

    const firstProps = screenProps.at(-1)
    firstProps.onDisconnect?.({ detail: {} })
    await vi.advanceTimersByTimeAsync(1100)

    expect(createVncToken).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("vnc-screen").getAttribute("data-url")).toBe(firstProps.url)
  })

  it("does not request server-side resize for the thumbnail viewer", async () => {
    render(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())
    expect(screen.getByTestId("vnc-screen").getAttribute("data-has-resize-session")).toBe("false")
  })

  it("shows a preview-unavailable fallback with redeploy action when the runtime is gone", async () => {
    render(React.createElement(VncThumbnail, {
      agent: {
        ...baseAgent,
        lifecycleStatus: "error",
        relayConnected: false,
        errorMessage: "Desktop runtime is unavailable. Redeploy to restore preview.",
        cost: 0.23,
        duration: "1d 17h",
      },
    }))

    expect(screen.getByText("preview unavailable")).toBeTruthy()
    expect(screen.getByText("Desktop runtime is unavailable. Redeploy to restore preview.")).toBeTruthy()

    screen.getByRole("button", { name: "Redeploy" }).click()
    expect(hardRestartAgent).toHaveBeenCalledWith("agent-1")
  })
})
