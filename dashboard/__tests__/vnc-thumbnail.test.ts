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
  previewState: "ready",
  previewRuntimeId: "sandbox-1",
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
  mcpConfig: {},
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

  it("keeps the VNC viewer mounted across relay flickers while preview remains ready", async () => {
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

  it("tears down and stops retrying when preview becomes unavailable", async () => {
    const { rerender } = render(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())
    expect(createVncToken).toHaveBeenCalledTimes(1)

    rerender(React.createElement(VncThumbnail, {
      agent: { ...baseAgent, previewState: "unavailable", previewRuntimeId: "" },
    }))

    const firstProps = screenProps.at(-1)
    firstProps.onDisconnect?.({ detail: { code: 1000, clean: true } })
    await vi.advanceTimersByTimeAsync(5000)

    expect(createVncToken).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("vnc-screen")).toBeNull()
    expect(screen.getByText("preview unavailable")).toBeTruthy()
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
        previewState: "error",
        previewRuntimeId: "",
        relayConnected: false,
        errorMessage: "Desktop runtime is unavailable. Redeploy to restore preview.",
        cost: 0.23,
        duration: "1d 17h",
      },
    }))

    expect(screen.getByText("runtime crashed")).toBeTruthy()
    expect(screen.getByText("Desktop runtime is unavailable. Redeploy to restore preview.")).toBeTruthy()

    screen.getByRole("button", { name: /redeploy/i }).click()
    expect(hardRestartAgent).toHaveBeenCalledWith("agent-1")
  })

  it("shows calm loading surface when preview is deploying during lifecycle deploy", async () => {
    render(React.createElement(VncThumbnail, {
      agent: {
        ...baseAgent,
        lifecycleStatus: "deploying",
        previewState: "deploying",
        previewRuntimeId: "",
        relayConnected: false,
      },
    }))

    expect(screen.getByText("starting desktop")).toBeTruthy()
    expect(screen.queryByText("runtime crashed")).toBeNull()
    expect(screen.queryByText("preview unavailable")).toBeNull()
    expect(screen.queryByRole("button", { name: /redeploy/i })).toBeNull()
  })

  it("shows calm loading surface when previewState=deploying even after lifecycle reaches idle", async () => {
    render(React.createElement(VncThumbnail, {
      agent: {
        ...baseAgent,
        lifecycleStatus: "idle",
        previewState: "deploying",
        previewRuntimeId: "",
        relayConnected: true,
      },
    }))

    expect(screen.getByText("starting desktop")).toBeTruthy()
    expect(screen.queryByText("preview unavailable")).toBeNull()
    expect(screen.queryByText("runtime crashed")).toBeNull()
    expect(screen.queryByRole("button", { name: /redeploy/i })).toBeNull()
  })

  it("recovers from an error fallback when the agent returns to idle", async () => {
    const { rerender } = render(React.createElement(VncThumbnail, {
      agent: {
        ...baseAgent,
        lifecycleStatus: "error",
        previewState: "error",
        previewRuntimeId: "",
        relayConnected: false,
        errorMessage: "Runtime crashed",
      },
    }))

    expect(screen.getByText("runtime crashed")).toBeTruthy()

    rerender(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())
    expect(createVncToken).toHaveBeenCalledTimes(1)
  })

  it("does not dim the whole preview when a session has ended", async () => {
    const { container } = render(React.createElement(VncThumbnail, {
      agent: {
        ...baseAgent,
        lifecycleStatus: "stopped",
        previewState: "unavailable",
        previewRuntimeId: "",
        relayConnected: false,
      },
    }))

    expect(screen.getByText("session ended")).toBeTruthy()
    expect((container.firstChild as HTMLElement).className.includes("opacity-50")).toBe(false)
  })

  it("fully resets and mints a new token when the preview runtime changes", async () => {
    const { rerender } = render(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())
    expect(createVncToken).toHaveBeenCalledTimes(1)

    rerender(React.createElement(VncThumbnail, {
      agent: { ...baseAgent, previewRuntimeId: "sandbox-2" },
    }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(createVncToken).toHaveBeenCalledTimes(2))
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })

  it("enters error state after repeated 4001 disconnects exhaust the retry budget", async () => {
    render(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())

    // Simulate repeated 4001 disconnects — each time a new token is issued
    // but the WS connection immediately fails again with 4001.
    // Use screenProps.at(-1) fresh each iteration to get the latest onDisconnect.
    for (let i = 0; i < 6; i++) {
      createVncToken.mockResolvedValue({
        data: { createVncToken: { token: `token-${i}` } },
      })
      screenProps.at(-1).onDisconnect?.({ detail: { code: 4001, clean: false } })
      // Advance enough for: immediate retry (0ms for first 4001) + token fetch + backoff
      await vi.advanceTimersByTimeAsync(500)
      // Let React process state updates
      await waitFor(() => {})
      await vi.advanceTimersByTimeAsync(35_000)
      await waitFor(() => {})
    }

    // After exhausting retry budget, should show error with retry button
    await waitFor(() => expect(screen.getByText(/preview connection lost/i)).toBeTruthy())
    expect(screen.queryByTestId("vnc-screen")).toBeNull()
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy()
  })

  it("clears error and fetches a fresh token when manual retry is clicked", async () => {
    render(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())

    // Exhaust retry budget
    for (let i = 0; i < 6; i++) {
      createVncToken.mockResolvedValue({
        data: { createVncToken: { token: `token-${i}` } },
      })
      screenProps.at(-1).onDisconnect?.({ detail: { code: 4001, clean: false } })
      await vi.advanceTimersByTimeAsync(500)
      await waitFor(() => {})
      await vi.advanceTimersByTimeAsync(35_000)
      await waitFor(() => {})
    }

    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy())

    const tokenCallsBefore = createVncToken.mock.calls.length
    createVncToken.mockResolvedValue({
      data: { createVncToken: { token: "fresh-token" } },
    })

    // Click retry — should reset budget and fetch fresh token
    screen.getByRole("button", { name: /retry/i }).click()
    await vi.advanceTimersByTimeAsync(50)

    expect(createVncToken.mock.calls.length).toBeGreaterThan(tokenCallsBefore)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())
  })

  it("enters error state after repeated token fetch failures exhaust the retry budget", async () => {
    createVncToken.mockRejectedValue(new Error("backend unavailable"))
    render(React.createElement(VncThumbnail, { agent: baseAgent }))

    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(35_000)
      await waitFor(() => {})
    }

    await waitFor(() => expect(screen.getByText(/preview connection lost/i)).toBeTruthy())
    expect(screen.queryByTestId("vnc-screen")).toBeNull()
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy()
  })

  it("resets the retry budget when the runtime ID changes", async () => {
    const { rerender } = render(React.createElement(VncThumbnail, { agent: baseAgent }))

    await vi.advanceTimersByTimeAsync(50)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())

    const props = screenProps.at(-1)
    // Accumulate some retries (but don't exhaust)
    for (let i = 0; i < 3; i++) {
      createVncToken.mockResolvedValue({
        data: { createVncToken: { token: `token-${i}` } },
      })
      props.onDisconnect?.({ detail: { code: 4001, clean: false } })
      await vi.advanceTimersByTimeAsync(5_000)
    }

    // Change runtime ID — should reset retry budget
    rerender(React.createElement(VncThumbnail, {
      agent: { ...baseAgent, previewRuntimeId: "sandbox-new" },
    }))

    await vi.advanceTimersByTimeAsync(50)

    // Should reconnect with fresh token (budget reset, not in error state)
    await waitFor(() => expect(screen.getByTestId("vnc-screen")).toBeTruthy())
    expect(screen.queryByText(/preview connection lost/i)).toBeNull()
  })
})
