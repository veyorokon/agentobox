"use client"

import { useEffect, useRef, useState } from "react"
import { FitAddon, Terminal, init as initGhostty } from "ghostty-web"
import { getToken } from "@/lib/auth"
import {
  WORKBENCH_MIN_TERMINAL_COLS,
  WORKBENCH_MIN_TERMINAL_ROWS,
} from "@/components/workbench/workbench-layout"

export type PaneAgent = {
  id: string
  name: string
  lifecycleStatus?: string | null
  relayConnected?: boolean | null
}

let ghosttyInitPromise: Promise<void> | null = null
function ensureGhosttyInit() {
  ghosttyInitPromise ??= initGhostty()
  return ghosttyInitPromise
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
    case "running": return "#8ec07c"
    case "deploying": return "#d8b56a"
    case "error": return "#d86c6c"
    default: return "#8ea4c7"
  }
}

/**
 * TerminalPane — one agent terminal in a resizable panel.
 *
 * Owns: ghostty Terminal, FitAddon, WebSocket, ResizeObserver.
 * The terminal div fills its container with position:absolute inset:0.
 * No padding, no border, no chrome inside the terminal area.
 * Header lives outside the terminal container.
 */
export function TerminalPane({
  agent,
  active,
  onActivate,
  showHeader = true,
  frozen = false,
}: {
  agent: PaneAgent
  active: boolean
  onActivate: () => void
  /** Show the built-in header. Set false when the parent provides its own chrome. */
  showHeader?: boolean
  /** Freeze terminal rendering during drag/resize. Suppresses fit + resize sends.
   *  On transition from frozen→unfrozen, one resize fires to sync final size. */
  frozen?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const frozenRef = useRef(frozen)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const authSentRef = useRef(false)
  const renderReadyRef = useRef(false)
  const wsReadyRef = useRef(false)
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sizeRef = useRef({ cols: 120, rows: 34 })
  const scheduleResizeRef = useRef<(() => void) | null>(null)
  const commitResizeRef = useRef<(() => boolean) | null>(null)
  const [reflowing, setReflowing] = useState(false)
  const reflowingRef = useRef(false)
  const onFrameDuringReflowRef = useRef<(() => void) | null>(null)
  const reflowFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevFrozenRef = useRef(frozen)

  const clearReflow = () => {
    if (reflowFallbackRef.current !== null) {
      clearTimeout(reflowFallbackRef.current)
      reflowFallbackRef.current = null
    }
    onFrameDuringReflowRef.current = null
    reflowingRef.current = false
    setReflowing(false)
  }

  useEffect(() => {
    const wasFrozen = prevFrozenRef.current
    prevFrozenRef.current = frozen
    frozenRef.current = frozen

    if (frozen) {
      if (resizeDebounceRef.current !== null) {
        clearTimeout(resizeDebounceRef.current)
        resizeDebounceRef.current = null
      }
      return
    }

    if (!wasFrozen || !commitResizeRef.current) return

    reflowingRef.current = true
    setReflowing(true)
    requestAnimationFrame(() => {
      const sent = commitResizeRef.current?.() ?? false
      if (!sent) {
        clearReflow()
        return
      }
      reflowFallbackRef.current = setTimeout(() => {
        clearReflow()
      }, 500)
      onFrameDuringReflowRef.current = () => {
        clearReflow()
      }
    })
    return () => {
      if (frozen) return
      if (reflowFallbackRef.current !== null) {
        clearTimeout(reflowFallbackRef.current)
        reflowFallbackRef.current = null
      }
    }
  }, [frozen])

  // Main effect: create terminal, connect WS, observe resize
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let terminal: Terminal | null = null
    let fitAddon: FitAddon | null = null
    let ws: WebSocket | null = null
    let dataDisposable: { dispose(): void } | null = null
    let resizeObserver: ResizeObserver | null = null
    let disposed = false

    // Fit terminal grid to container (immediate, local only)
    const fitLocal = () => {
      if (!terminal || !fitAddon || !renderReadyRef.current) return false
      try { fitAddon.fit() } catch { return false }
      const cols = Math.max(WORKBENCH_MIN_TERMINAL_COLS, terminal.cols || 0)
      const rows = Math.max(WORKBENCH_MIN_TERMINAL_ROWS, terminal.rows || 0)
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return false
      sizeRef.current = { cols, rows }
      return true
    }

    // Send resize to PTY (debounced, only if changed)
    const sendResizeToServer = () => {
      const { cols, rows } = sizeRef.current
      if (!authSentRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false
      const last = lastSentSizeRef.current
      if (last && last.cols === cols && last.rows === rows) return false
      lastSentSizeRef.current = { cols, rows }
      wsRef.current.send(JSON.stringify({ type: "resize", terminal_id: "main", cols, rows }))
      return true
    }

    const commitResizeNow = () => {
      if (frozenRef.current) return false
      if (resizeDebounceRef.current !== null) {
        clearTimeout(resizeDebounceRef.current)
        resizeDebounceRef.current = null
      }
      if (!fitLocal()) return false
      return sendResizeToServer()
    }

    // Schedule: fit locally in rAF, debounce WS send by 100ms.
    // Suppressed while frozen — the unfreeze effect fires one resize on release.
    const scheduleResize = () => {
      if (frozenRef.current) return
      requestAnimationFrame(() => { fitLocal() })
      if (resizeDebounceRef.current !== null) clearTimeout(resizeDebounceRef.current)
      resizeDebounceRef.current = setTimeout(() => {
        resizeDebounceRef.current = null
        fitLocal()
        sendResizeToServer()
      }, 100)
    }
    scheduleResizeRef.current = scheduleResize
    commitResizeRef.current = commitResizeNow

    void ensureGhosttyInit().then(() => {
      if (disposed) return

      fitAddon = new FitAddon()
      fitAddonRef.current = fitAddon
      terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily: '"SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
        fontSize: 14,
        theme: {
          background: "#1b1f26",
          foreground: "#c5cdd8",
          cursor: "#f5f7fb",
          cursorAccent: "#1b1f26",
          selectionBackground: "rgba(125, 145, 184, 0.34)",
          black: "#1b1f26",
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
      terminalRef.current = terminal

      const token = getToken()
      if (!token) {
        terminal.writeln("[auth missing]")
        return
      }

      // Auth sends real fitted dimensions, not defaults.
      // Only sends if fitLocal() succeeds — avoids stale 120x34 default.
      const sendAuth = () => {
        if (!ws || ws.readyState !== WebSocket.OPEN || authSentRef.current) return
        if (!fitLocal()) return  // host not measurable yet — retry on next rAF
        ws.send(JSON.stringify({
          type: "auth",
          token,
          terminal_id: "main",
          program: "claude",
          cols: sizeRef.current.cols,
          rows: sizeRef.current.rows,
        }))
        authSentRef.current = true
        lastSentSizeRef.current = { ...sizeRef.current }
      }

      ws = new WebSocket(buildTerminalWsUrl(agent.id))
      wsRef.current = ws

      ws.addEventListener("open", () => {
        wsReadyRef.current = true
        if (renderReadyRef.current) sendAuth()
      })

      ws.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data))
        if (message.type !== "terminal_event" || !terminal) return
        if (message.event_type === "frame" && typeof message.payload?.data === "string") {
          terminal.write(message.payload.data)
          // Clear reflow overlay once the PTY has sent back redrawn content
          onFrameDuringReflowRef.current?.()
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
        terminal?.writeln("\r\n[disconnected]")
      })

      dataDisposable = terminal.onData((data) => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !authSentRef.current) return
        ws.send(JSON.stringify({ type: "input", terminal_id: "main", data }))
      })

      // Font size shortcuts
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown" || !(event.metaKey || event.ctrlKey) || event.altKey) return false
        if (event.key === "=" || event.key === "+") {
          event.preventDefault()
          if (terminal) { terminal.options.fontSize = (terminal.options.fontSize ?? 14) + 1; scheduleResize() }
          return true
        }
        if (event.key === "-") {
          event.preventDefault()
          if (terminal) { terminal.options.fontSize = Math.max(8, (terminal.options.fontSize ?? 14) - 1); scheduleResize() }
          return true
        }
        if (event.key === "0") {
          event.preventDefault()
          if (terminal) { terminal.options.fontSize = 14; scheduleResize() }
          return true
        }
        return false
      })

      // Mark render-ready after two frames, then fit + auth
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (disposed) return
          renderReadyRef.current = true
          fitLocal()
          if (wsReadyRef.current && !authSentRef.current) sendAuth()
          scheduleResize()
        })
      })

      // ResizeObserver on the host div — the single source of truth for size changes
      resizeObserver = new ResizeObserver(() => {
        if (!renderReadyRef.current) return
        scheduleResize()
      })
      resizeObserver.observe(host)
    })

    return () => {
      disposed = true
      const wasAuth = authSentRef.current
      authSentRef.current = false
      renderReadyRef.current = false
      wsReadyRef.current = false
      lastSentSizeRef.current = null
      commitResizeRef.current = null
      if (resizeDebounceRef.current !== null) {
        clearTimeout(resizeDebounceRef.current)
        resizeDebounceRef.current = null
      }
      clearReflow()
      dataDisposable?.dispose()
      resizeObserver?.disconnect()
      if (wasAuth && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "close", terminal_id: "main" }))
      }
      ws?.close()
      wsRef.current = null
      fitAddonRef.current = null
      terminal?.dispose()
      terminalRef.current = null
    }
  }, [agent.id])

  // Focus management
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      const host = hostRef.current
      if (!host) return
      const textarea = host.querySelector("textarea")
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus()
      } else {
        terminalRef.current?.focus()
      }
    })
  }, [active])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.cursorBlink = !(frozen || reflowing)
  }, [frozen, reflowing])

  return (
    <div
      className="flex h-full flex-col"
      onMouseDown={onActivate}
    >
      {/* Header — outside terminal container. Hidden when parent provides its own chrome. */}
      {showHeader && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[#3a3f4b] bg-[#252830] px-3">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: statusDot(agent.lifecycleStatus) }}
          />
          <span className="truncate font-mono text-[11px] font-medium text-[#9aa3b0]">
            {agent.name}
          </span>
        </div>
      )}

      {/* Terminal container — owns its rectangle completely */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={hostRef}
          className="absolute inset-0"
        />
      </div>
    </div>
  )
}
