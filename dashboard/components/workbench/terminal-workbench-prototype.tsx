"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { FitAddon, Terminal, init as initGhostty } from "ghostty-web"
import { Minus } from "lucide-react"
import { getToken } from "@/lib/auth"
import {
  buildInitialWorkbenchWindows,
  gridWindowHeight,
  gridWindowWidth,
  WORKBENCH_MINIMIZED_HEIGHT,
  WORKBENCH_MIN_TERMINAL_COLS,
  WORKBENCH_MIN_TERMINAL_ROWS,
  WORKBENCH_TITLEBAR_HEIGHT,
} from "@/components/workbench/workbench-layout"

export type WorkbenchAgent = {
  id: string
  name: string
  lifecycleStatus?: string | null
  relayConnected?: boolean | null
}

type WindowRect = {
  x: number
  y: number
  width: number
  height: number
}

type TerminalWindow = WindowRect & {
  id: string
  agentId: string
  fontSize: number
  cellWidth?: number
  cellHeight?: number
  z: number
  minimized: boolean
  maximized: boolean
  hidden: boolean
  lastRect?: WindowRect
}

let ghosttyInitPromise: Promise<void> | null = null

function ensureGhosttyInit() {
  ghosttyInitPromise ??= initGhostty()
  return ghosttyInitPromise
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function buildTerminalWsUrl(agentId: string) {
  const { protocol, hostname, port } = window.location
  const wsProto = protocol === "https:" ? "wss:" : "ws:"
  const host = !port || port === "80" || port === "443"
    ? hostname
    : `${hostname}:8000`
  return `${wsProto}//${host}/ws/terminal/${agentId}/`
}

function statusDot(status?: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "running":
      return "#8ec07c"
    case "deploying":
      return "#d8b56a"
    case "error":
      return "#d86c6c"
    default:
      return "#8ea4c7"
  }
}

function TerminalViewport({
  agent,
  active,
  onActivate,
  fontSize,
  onFontSizeChange,
  onMetricsChange,
}: {
  agent: WorkbenchAgent
  active: boolean
  onActivate: () => void
  fontSize: number
  onFontSizeChange: (nextFontSize: number) => void
  onMetricsChange: (metrics: { cols: number; rows: number; cellWidth: number; cellHeight: number }) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const authSentRef = useRef(false)
  const renderReadyRef = useRef(false)
  const pendingResizeFrameRef = useRef<number | null>(null)
  const fontSizeRef = useRef(fontSize)
  const onFontSizeChangeRef = useRef(onFontSizeChange)
  const onMetricsChangeRef = useRef(onMetricsChange)
  const sizeRef = useRef({ cols: 120, rows: 34 })

  useEffect(() => {
    fontSizeRef.current = fontSize
  }, [fontSize])

  useEffect(() => {
    onFontSizeChangeRef.current = onFontSizeChange
  }, [onFontSizeChange])

  useEffect(() => {
    onMetricsChangeRef.current = onMetricsChange
  }, [onMetricsChange])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let terminal: Terminal | null = null
    let fitAddon: FitAddon | null = null
    let ws: WebSocket | null = null
    let dataDisposable: { dispose(): void } | null = null
    let renderDisposable: { dispose(): void } | null = null
    let resizeObserver: ResizeObserver | null = null
    let disposed = false

    const syncGeometry = () => {
      if (!terminal || !fitAddon) return false
      if (!renderReadyRef.current) return false
      try {
        fitAddon.fit()
      } catch {
        return false
      }
      const cols = Math.max(WORKBENCH_MIN_TERMINAL_COLS, terminal.cols || 0)
      const rows = Math.max(WORKBENCH_MIN_TERMINAL_ROWS, terminal.rows || 0)
      sizeRef.current = { cols, rows }
      const width = host.clientWidth
      const height = host.clientHeight
      if (width <= 0 || height <= 0) return false
      onMetricsChangeRef.current({
        cols,
        rows,
        cellWidth: width / cols,
        cellHeight: height / rows,
      })
      if (authSentRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "resize",
          terminal_id: "main",
          cols,
          rows,
        }))
      }
      return true
    }

    const sendResize = () => {
      if (syncGeometry()) return
    }

    const scheduleResize = () => {
      if (pendingResizeFrameRef.current !== null) return
      pendingResizeFrameRef.current = requestAnimationFrame(() => {
        pendingResizeFrameRef.current = requestAnimationFrame(() => {
          pendingResizeFrameRef.current = null
          sendResize()
        })
      })
    }

    void ensureGhosttyInit().then(() => {
      if (disposed) return

      fitAddon = new FitAddon()
      fitAddonRef.current = fitAddon
      terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily: '"SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
        fontSize,
        theme: {
          background: "#303640",
          foreground: "#c5cdd8",
          cursor: "#f5f7fb",
          cursorAccent: "#303640",
          selectionBackground: "rgba(125, 145, 184, 0.34)",
          black: "#303640",
          brightBlack: "#7d8796",
          red: "#d88d87",
          brightRed: "#e2a19a",
          green: "#b2c28d",
          brightGreen: "#c2d29b",
          yellow: "#d5c08f",
          brightYellow: "#e3d09b",
          blue: "#8ea4c7",
          brightBlue: "#a2b8db",
          magenta: "#b39fce",
          brightMagenta: "#c4b0de",
          cyan: "#95bdc8",
          brightCyan: "#a5d0dc",
          white: "#cbd4df",
          brightWhite: "#eef2f8",
        },
      })
      terminal.loadAddon(fitAddon)
      terminal.open(host)
      terminal.writeln(`connecting ${agent.name}...`)
      terminalRef.current = terminal

      const token = getToken()
      if (!token) {
        terminal.writeln("[auth missing]")
        return
      }

      ws = new WebSocket(buildTerminalWsUrl(agent.id))
      wsRef.current = ws

      ws.addEventListener("open", () => {
        sendResize()
        ws?.send(JSON.stringify({
          type: "auth",
          token,
          terminal_id: "main",
          program: "claude",
          cols: sizeRef.current.cols,
          rows: sizeRef.current.rows,
        }))
        authSentRef.current = true
      })

      ws.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data))
        if (message.type !== "terminal_event" || !terminal) return
        if (message.event_type === "frame" && typeof message.payload?.data === "string") {
          terminal.write(message.payload.data)
          return
        }
        if (message.event_type === "error") {
          terminal.writeln(`\r\n[terminal error] ${message.payload?.error ?? "unknown"}`)
          return
        }
        if (message.event_type === "exited") {
          terminal.writeln(`\r\n[process exited ${message.payload?.exit_code ?? 0}]`)
        }
      })

      ws.addEventListener("close", () => {
        authSentRef.current = false
        terminal?.writeln("\r\n[terminal disconnected]")
      })

      dataDisposable = terminal.onData((data) => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !authSentRef.current) return
        ws.send(JSON.stringify({
          type: "input",
          terminal_id: "main",
          data,
        }))
      })

      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true
        if (!(event.metaKey || event.ctrlKey)) return true
        if (event.altKey) return true

        if (event.key === "=" || event.key === "+") {
          event.preventDefault()
          onFontSizeChangeRef.current(fontSizeRef.current + 1)
          return false
        }
        if (event.key === "-") {
          event.preventDefault()
          onFontSizeChangeRef.current(fontSizeRef.current - 1)
          return false
        }
        if (event.key === "0") {
          event.preventDefault()
          onFontSizeChangeRef.current(17)
          return false
        }
        return true
      })

      renderDisposable = terminal.onRender(() => {
        if (renderReadyRef.current) return
        renderReadyRef.current = true
        scheduleResize()
      })

      resizeObserver = new ResizeObserver(() => {
        if (!renderReadyRef.current) return
        scheduleResize()
      })
      resizeObserver.observe(host)
      scheduleResize()
    })

    return () => {
      disposed = true
      const wasAuthenticated = authSentRef.current
      authSentRef.current = false
      renderReadyRef.current = false
      if (pendingResizeFrameRef.current !== null) {
        cancelAnimationFrame(pendingResizeFrameRef.current)
        pendingResizeFrameRef.current = null
      }
      dataDisposable?.dispose()
      renderDisposable?.dispose()
      resizeObserver?.disconnect()
      if (wasAuthenticated && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "close", terminal_id: "main" }))
      }
      ws?.close()
      wsRef.current = null
      fitAddonRef.current = null
      terminal?.dispose()
      terminalRef.current = null
    }
  }, [agent.id, agent.name])

  useEffect(() => {
    const terminal = terminalRef.current
    const host = hostRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !host || !fitAddon || !renderReadyRef.current) return
    terminal.options.fontSize = fontSize
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const width = host.clientWidth
        const height = host.clientHeight
        if (width === 0 || height === 0) return
        try {
          fitAddon.fit()
      } catch {
        return
      }
      const cols = Math.max(WORKBENCH_MIN_TERMINAL_COLS, terminal.cols || 0)
      const rows = Math.max(WORKBENCH_MIN_TERMINAL_ROWS, terminal.rows || 0)
      sizeRef.current = { cols, rows }
      onMetricsChangeRef.current({
        cols,
        rows,
        cellWidth: width / cols,
        cellHeight: height / rows,
      })
      if (authSentRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "resize",
            terminal_id: "main",
            cols,
          rows,
        }))
      }
      })
    })
  }, [fontSize])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      terminalRef.current?.focus()
    })
  }, [active])

  return (
    <div className="h-full w-full" onMouseDown={onActivate}>
      <div ref={hostRef} className="h-full w-full overflow-hidden" />
    </div>
  )
}

export function TerminalWorkbenchPrototype({
  agents,
  initialAgentIds = [],
  onCloseAgent,
}: {
  agents: WorkbenchAgent[]
  initialAgentIds?: string[]
  onCloseAgent?: (agentId: string) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const windowsRef = useRef<TerminalWindow[]>([])
  const nextZRef = useRef(1)

  const agentsById = useMemo(
    () => new Map(agents.map(agent => [agent.id, agent])),
    [agents],
  )
  const [activeWindowId, setActiveWindowId] = useState("")
  const [windows, setWindows] = useState<TerminalWindow[]>([])

  useEffect(() => {
    if (agents.length === 0) {
      setWindows([])
      setActiveWindowId("")
      nextZRef.current = 1
      return
    }
    setWindows(prev => {
      const requested = buildInitialWorkbenchWindows(agents, initialAgentIds)
      if (requested.length === 0) {
        const remaining = prev.filter(window => agentsById.has(window.agentId) && !window.hidden)
        nextZRef.current = remaining.reduce((max, window) => Math.max(max, window.z), 0) + 1
        if (!remaining.some(window => window.id === activeWindowId)) {
          setActiveWindowId([...remaining].sort((a, b) => b.z - a.z)[0]?.id ?? "")
        }
        return remaining
      }

      const prevByAgentId = new Map(
        prev.filter(window => agentsById.has(window.agentId)).map(window => [window.agentId, window]),
      )
      const nextWindows = requested.map(window => {
        const existing = prevByAgentId.get(window.agentId)
        return existing ? { ...existing, hidden: false } : window
      })
      nextZRef.current = nextWindows.reduce((max, window) => Math.max(max, window.z), 0) + 1
      if (!nextWindows.some(window => window.id === activeWindowId)) {
        setActiveWindowId(nextWindows[0]?.id ?? "")
      }
      return nextWindows
    })
  }, [activeWindowId, agents, agentsById, initialAgentIds])

  useEffect(() => {
    windowsRef.current = windows
  }, [windows])

  const focusWindow = (windowId: string, raise = false) => {
    setActiveWindowId(windowId)
    if (!raise) return
    setWindows(prev => prev.map(window => (
      window.id === windowId ? { ...window, z: nextZRef.current++ } : window
    )))
  }

  const setWindowFontSize = (windowId: string, nextFontSize: number) => {
    setWindows(prev => prev.map(window => (
      window.id === windowId
        ? { ...window, fontSize: clamp(nextFontSize, 13, 24) }
        : window
    )))
  }

  const setWindowMetrics = (
    windowId: string,
    metrics: { cols: number; rows: number; cellWidth: number; cellHeight: number },
  ) => {
    setWindows(prev => prev.map(window => {
      if (window.id !== windowId) return window
      if (
        window.cellWidth === metrics.cellWidth &&
        window.cellHeight === metrics.cellHeight
      ) {
        return window
      }
      return {
        ...window,
        cellWidth: metrics.cellWidth,
        cellHeight: metrics.cellHeight,
      }
    }))
  }

  const closeWindow = (windowId: string) => {
    const closing = windowsRef.current.find(window => window.id === windowId)
    if (closing && onCloseAgent) onCloseAgent(closing.agentId)
    setWindows(prev => prev.map(window => (
      window.id === windowId ? { ...window, hidden: true } : window
    )))
    if (activeWindowId === windowId) {
      const fallback = windowsRef.current
        .filter(window => !window.hidden && window.id !== windowId)
        .sort((a, b) => b.z - a.z)[0]
      if (fallback) setActiveWindowId(fallback.id)
    }
  }

  const minimizeWindow = (windowId: string) => {
    setWindows(prev => prev.map(window => (
      window.id === windowId
        ? {
            ...window,
            minimized: !window.minimized,
            height: window.minimized ? (window.lastRect?.height ?? window.height) : WORKBENCH_MINIMIZED_HEIGHT,
            lastRect: window.minimized
              ? undefined
              : { x: window.x, y: window.y, width: window.width, height: window.height },
          }
        : window
    )))
  }

  const toggleMaximize = (windowId: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    setWindows(prev => prev.map(window => {
      if (window.id !== windowId) return window
      if (window.maximized && window.lastRect) {
        return {
          ...window,
          ...window.lastRect,
          maximized: false,
          lastRect: undefined,
          minimized: false,
          z: nextZRef.current++,
        }
      }
      return {
        ...window,
        x: 18,
        y: 18,
        width: Math.max(640, canvas.clientWidth - 36),
        height: Math.max(340, canvas.clientHeight - 36),
        maximized: true,
        minimized: false,
        lastRect: { x: window.x, y: window.y, width: window.width, height: window.height },
        z: nextZRef.current++,
      }
    }))
    setActiveWindowId(windowId)
  }

  const beginWindowPointerSession = (
    mode: "drag" | "resize",
    windowId: string,
    startX: number,
    startY: number,
  ) => {
    const canvas = canvasRef.current
    const target = windowsRef.current.find(window => window.id === windowId)
    if (!canvas || !target || target.maximized || target.hidden) return

    const canvasRect = canvas.getBoundingClientRect()
    const origin = { x: target.x, y: target.y, width: target.width, height: target.height }

    document.documentElement.classList.add("dragging-resize")
    window.getSelection()?.removeAllRanges()

    const onMove = (event: PointerEvent) => {
      event.preventDefault()
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      setWindows(prev => prev.map(current => {
        if (current.id !== windowId) return current
        if (mode === "drag") {
          const minX = -current.width + 180
          const maxX = canvasRect.width - 80
          const minY = 0
          const maxY = canvasRect.height - 44
          return {
            ...current,
            x: clamp(origin.x + dx, minX, maxX),
            y: clamp(origin.y + dy, minY, maxY),
          }
        }
        if (current.cellWidth && current.cellHeight) {
          const rawWidth = origin.width + dx
          const rawHeight = origin.height + dy
          const maxWidth = canvasRect.width - current.x + current.width - 80
          const maxHeight = canvasRect.height - current.y + current.height - 48
          const cols = clamp(
            Math.round(rawWidth / current.cellWidth),
            WORKBENCH_MIN_TERMINAL_COLS,
            Math.max(WORKBENCH_MIN_TERMINAL_COLS, Math.floor(maxWidth / current.cellWidth)),
          )
          const rows = clamp(
            Math.round((rawHeight - WORKBENCH_TITLEBAR_HEIGHT) / current.cellHeight),
            WORKBENCH_MIN_TERMINAL_ROWS,
            Math.max(
              WORKBENCH_MIN_TERMINAL_ROWS,
              Math.floor((maxHeight - WORKBENCH_TITLEBAR_HEIGHT) / current.cellHeight),
            ),
          )
          return {
            ...current,
            width: gridWindowWidth(cols, current.cellWidth),
            height: gridWindowHeight(rows, current.cellHeight),
          }
        }
        return {
          ...current,
          width: clamp(origin.width + dx, 640, canvasRect.width - current.x + current.width - 80),
          height: clamp(origin.height + dy, 360, canvasRect.height - current.y + current.height - 48),
        }
      }))
    }

    const onUp = () => {
      document.documentElement.classList.remove("dragging-resize")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }

    window.addEventListener("pointermove", onMove, { passive: false })
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const adjust = () => {
      const rect = canvas.getBoundingClientRect()
      setWindows(prev => prev.map(window => {
        if (window.maximized || window.hidden) return window
        return {
          ...window,
          x: clamp(window.x, -window.width + 180, rect.width - 80),
          y: clamp(window.y, 0, rect.height - 44),
        }
      }))
    }
    adjust()
    window.addEventListener("resize", adjust)
    return () => window.removeEventListener("resize", adjust)
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-[#1b1f26] text-default">
      <main ref={canvasRef} className="relative h-full w-full overflow-hidden bg-[#1b1f26]">
        {windows
          .filter(window => !window.hidden)
          .sort((a, b) => a.z - b.z)
          .map(window => {
            const agent = agentsById.get(window.agentId)
            if (!agent) return null
            const active = activeWindowId === window.id

            return (
              <section
                key={window.id}
                className={`absolute overflow-hidden rounded-[28px] border bg-[#303640] shadow-[0_22px_60px_rgba(0,0,0,0.30)] transition-shadow ${
                  active ? "border-[#717887]" : "border-[#5e6572]"
                }`}
                style={{
                  left: window.x,
                  top: window.y,
                  width: window.width,
                  height: window.minimized ? WORKBENCH_MINIMIZED_HEIGHT : window.height,
                  zIndex: window.z,
                }}
                onMouseDown={() => focusWindow(window.id)}
              >
                <div
                  className="flex items-center gap-2 bg-[#303640] px-5"
                  style={{ height: WORKBENCH_TITLEBAR_HEIGHT }}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    focusWindow(window.id, true)
                    beginWindowPointerSession("drag", window.id, event.clientX, event.clientY)
                  }}
                >
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      closeWindow(window.id)
                    }}
                    className="h-3.5 w-3.5 rounded-full bg-[#ff5f56] transition-transform hover:scale-110"
                    title="Close"
                  />
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      minimizeWindow(window.id)
                    }}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ffbd2e] transition-transform hover:scale-110"
                    title={window.minimized ? "Restore" : "Minimize"}
                  >
                    <Minus className="h-2 w-2 text-black/55" />
                  </button>
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleMaximize(window.id)
                    }}
                    className="h-3.5 w-3.5 rounded-full bg-[#27c93f] transition-transform hover:scale-110"
                    title={window.maximized ? "Restore" : "Maximize"}
                  />

                  <div className="ml-2 flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: statusDot(agent.lifecycleStatus) }}
                    />
                    <span className="truncate font-mono text-[12px] font-medium tracking-[0.01em] text-[#d0d7e2]">
                      {agent.name}
                    </span>
                  </div>
                </div>

                {!window.minimized && (
                  <>
                    <div
                      className="relative"
                      style={{ height: window.height - WORKBENCH_TITLEBAR_HEIGHT }}
                    >
                      <TerminalViewport
                        agent={agent}
                        active={active}
                        onActivate={() => focusWindow(window.id)}
                        fontSize={window.fontSize}
                        onFontSizeChange={(nextFontSize) => setWindowFontSize(window.id, nextFontSize)}
                        onMetricsChange={(metrics) => setWindowMetrics(window.id, metrics)}
                      />
                    </div>

                    {!window.maximized && (
                      <button
                        type="button"
                        className="absolute bottom-0 right-0 h-7 w-7 cursor-se-resize bg-gradient-to-br from-transparent to-white/[0.06] opacity-0 transition-opacity hover:opacity-100"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          focusWindow(window.id, true)
                          beginWindowPointerSession("resize", window.id, event.clientX, event.clientY)
                        }}
                        aria-label="Resize terminal"
                      />
                    )}
                  </>
                )}
              </section>
            )
          })}
      </main>
    </div>
  )
}
