// @vitest-environment jsdom

import React from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let mockCols = 80
let mockRows = 24

class MockTerminal {
  cols = 0
  rows = 0
  options: { fontSize?: number } = { fontSize: 14 }
  write = vi.fn()
  writeln = vi.fn()
  focus = vi.fn()
  dispose = vi.fn()
  loadAddon(addon: { terminal?: MockTerminal }) {
    addon.terminal = this
  }
  open() {}
  onData() {
    return { dispose() {} }
  }
  attachCustomKeyEventHandler() {}
}

class MockFitAddon {
  terminal: MockTerminal | null = null
  fit() {
    if (!this.terminal) return
    this.terminal.cols = mockCols
    this.terminal.rows = mockRows
  }
}

vi.mock("ghostty-web", () => ({
  Terminal: MockTerminal,
  FitAddon: MockFitAddon,
  init: vi.fn(async () => {}),
}))

vi.mock("@/lib/auth", () => ({
  getToken: () => "test-token",
}))

type SentMessage =
  | { type: "auth"; cols: number; rows: number; token: string; terminal_id: string; program: string }
  | { type: "resize"; cols: number; rows: number; terminal_id: string }
  | { type: "close"; terminal_id: string }
  | { type: "input"; terminal_id: string; data: string }

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = 0
  sent: SentMessage[] = []
  listeners: Record<string, Array<(event: unknown) => void>> = {}

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (event: unknown) => void) {
    this.listeners[type] ??= []
    this.listeners[type].push(cb)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as SentMessage)
  }

  close() {
    this.readyState = 3
    this.emit("close", {})
  }

  open() {
    this.readyState = 1
    this.emit("open", {})
  }

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners[type] ?? []) listener(event)
  }
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  constructor(private readonly cb: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this)
  }
  observe() {}
  disconnect() {}
  trigger() {
    this.cb([] as ResizeObserverEntry[], this as unknown as ResizeObserver)
  }
}

Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return 800
  },
})

Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return 480
  },
})

beforeEach(() => {
  vi.useFakeTimers()
  mockCols = 80
  mockRows = 24
  MockWebSocket.instances = []
  MockResizeObserver.instances = []
  vi.stubGlobal("WebSocket", MockWebSocket)
  vi.stubGlobal("ResizeObserver", MockResizeObserver)
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function flushTimers() {
  await act(async () => {
    await Promise.resolve()
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
  })
}

describe("TerminalPane", () => {
  it("does not leak a queued resize while frozen", async () => {
    const { TerminalPane } = await import("@/components/workbench/terminal-pane")
    const view = render(
      React.createElement(
        "div",
        { style: { width: 800, height: 480 } },
        React.createElement(TerminalPane, {
          agent: { id: "a1", name: "local-continuity", lifecycleStatus: "running" },
          active: true,
          onActivate: () => {},
          frozen: false,
          showHeader: false,
        }),
      ),
    )

    await flushTimers()

    const ws = MockWebSocket.instances[0]
    expect(ws).toBeTruthy()

    await act(async () => {
      ws.open()
    })
    await flushTimers()
    await flushTimers()

    expect(ws.sent.filter(message => message.type === "auth")).toHaveLength(1)

    mockCols = 96
    mockRows = 30
    act(() => {
      MockResizeObserver.instances[0].trigger()
    })

    view.rerender(
      React.createElement(
        "div",
        { style: { width: 800, height: 480 } },
        React.createElement(TerminalPane, {
          agent: { id: "a1", name: "local-continuity", lifecycleStatus: "running" },
          active: true,
          onActivate: () => {},
          frozen: true,
          showHeader: false,
        }),
      ),
    )

    await flushTimers()

    expect(ws.sent.filter(message => message.type === "resize")).toHaveLength(0)
  })

  it("commits one resize when released from freeze", async () => {
    const { TerminalPane } = await import("@/components/workbench/terminal-pane")
    const view = render(
      React.createElement(
        "div",
        { style: { width: 800, height: 480 } },
        React.createElement(TerminalPane, {
          agent: { id: "a1", name: "local-continuity", lifecycleStatus: "running" },
          active: true,
          onActivate: () => {},
          frozen: true,
          showHeader: false,
        }),
      ),
    )

    await flushTimers()

    const ws = MockWebSocket.instances[0]
    expect(ws).toBeTruthy()

    await act(async () => {
      ws.open()
    })
    await flushTimers()
    await flushTimers()

    expect(ws.sent.filter(message => message.type === "auth")).toHaveLength(1)

    mockCols = 101
    mockRows = 29

    view.rerender(
      React.createElement(
        "div",
        { style: { width: 800, height: 480 } },
        React.createElement(TerminalPane, {
          agent: { id: "a1", name: "local-continuity", lifecycleStatus: "running" },
          active: true,
          onActivate: () => {},
          frozen: false,
          showHeader: false,
        }),
      ),
    )

    await flushTimers()

    const resizes = ws.sent.filter(message => message.type === "resize")
    expect(resizes).toHaveLength(1)
    expect(resizes[0]).toMatchObject({ cols: 101, rows: 29, terminal_id: "main" })
  })
})
