"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Bell, Minus, X } from "lucide-react"
import { Terminal } from "@/lib/vendor/xterm.mjs"
import { cn } from "@/lib/utils"

type AgentSeed = {
  id: string
  name: string
  status: "active" | "running" | "blocked" | "idle"
  badge?: string
  lines: string[]
  prompt: string
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
  z: number
  minimized: boolean
  maximized: boolean
  hidden: boolean
  lastRect?: WindowRect
}

const AGENTS: AgentSeed[] = [
  {
    id: "team-lead",
    name: "@team-lead",
    status: "active",
    badge: "desktop ready",
    lines: [
      "[supervisor] coordinating 4 active agents",
      "[task] break #154 into runtime and UX follow-ups",
      "> ask @builder-1 to validate MCP launch contract",
      "> ask @qa-1 to probe continuity after redeploy",
      "[note] waiting on remote proof before closing #150",
    ],
    prompt: "\u001b[38;2;147;197;114m[lead]\u001b[0m",
  },
  {
    id: "builder-1",
    name: "@builder-1",
    status: "running",
    badge: "browser active",
    lines: [
      "[build] compiling dashboard prototype",
      "[artifact] terminal workbench route ready",
      "> pnpm --dir dashboard typecheck",
      "[ok] current branch is clean",
    ],
    prompt: "\u001b[38;2;147;197;114m[run]\u001b[0m",
  },
  {
    id: "qa-1",
    name: "@qa-1",
    status: "blocked",
    badge: "approval needed",
    lines: [
      "[qa] waiting on fresh dev deploy",
      "[gap] remote continuity proof not rerun yet",
      "> capture incident if post-redeploy memory fails again",
    ],
    prompt: "\u001b[38;2;147;197;114m[wait]\u001b[0m",
  },
]

const STATUS_TONE: Record<AgentSeed["status"], string> = {
  active: "text-success",
  running: "text-info",
  blocked: "text-warning",
  idle: "text-muted",
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getAgent(agentId: string) {
  return AGENTS.find(agent => agent.id === agentId) ?? AGENTS[0]!
}

function TerminalViewport({
  agent,
  active,
  onActivate,
}: {
  agent: AgentSeed
  active: boolean
  onActivate: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const terminal = new Terminal({
      disableStdin: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 15,
      fontWeight: 500,
      lineHeight: 1.45,
      letterSpacing: 0.1,
      theme: {
        background: "#1f2430",
        foreground: "#d7dce4",
        cursor: "#d7dce4",
        cursorAccent: "#1f2430",
        selectionBackground: "rgba(124, 156, 201, 0.45)",
        black: "#1f2430",
        brightBlack: "#7f8796",
        red: "#ff7b72",
        brightRed: "#ff9b93",
        green: "#93c572",
        brightGreen: "#b7dd8f",
        yellow: "#e3b341",
        brightYellow: "#f2cc60",
        blue: "#7ca3d6",
        brightBlue: "#99b7df",
        magenta: "#c678dd",
        brightMagenta: "#d79bf0",
        cyan: "#7bdff2",
        brightCyan: "#9af0ff",
        white: "#d7dce4",
        brightWhite: "#f5f7fa",
      },
    })
    terminal.open(host)

    agent.lines.forEach(line => terminal.writeln(line))
    terminal.writeln("")
    terminal.write(`${agent.prompt} \u2588`)

    terminalRef.current = terminal

    const resizeTerminal = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      const cols = Math.max(24, Math.floor((width - 24) / 9.2))
      const rows = Math.max(8, Math.floor((height - 18) / 22))
      terminal.resize(cols, rows)
    }
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(resizeTerminal)
    })
    resizeObserver.observe(host)
    requestAnimationFrame(resizeTerminal)

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [agent])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        terminalRef.current?.focus()
      })
    }
  }, [active])

  return (
    <div className="relative h-full w-full" onMouseDown={onActivate}>
      <div ref={hostRef} className="h-full w-full px-4 py-3" />
      {!active && (
        <button
          type="button"
          onClick={onActivate}
          className="absolute inset-0 cursor-default bg-transparent"
          aria-label={`Focus ${agent.name}`}
        />
      )}
    </div>
  )
}

export function TerminalWorkbenchPrototype() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const windowsRef = useRef<TerminalWindow[]>([])
  const nextZRef = useRef(4)

  const [activeWindowId, setActiveWindowId] = useState("win-builder-1")
  const [windows, setWindows] = useState<TerminalWindow[]>([
    {
      id: "win-team-lead",
      agentId: "team-lead",
      x: 210,
      y: 58,
      width: 632,
      height: 356,
      z: 1,
      minimized: false,
      maximized: false,
      hidden: false,
    },
    {
      id: "win-builder-1",
      agentId: "builder-1",
      x: 72,
      y: 282,
      width: 554,
      height: 354,
      z: 2,
      minimized: false,
      maximized: false,
      hidden: false,
    },
    {
      id: "win-qa-1",
      agentId: "qa-1",
      x: 730,
      y: 222,
      width: 470,
      height: 296,
      z: 3,
      minimized: false,
      maximized: false,
      hidden: false,
    },
  ])

  useEffect(() => {
    windowsRef.current = windows
  }, [windows])

  const focusWindow = (windowId: string) => {
    setActiveWindowId(windowId)
    setWindows(prev => prev.map(window => (
      window.id === windowId ? { ...window, z: nextZRef.current++ } : window
    )))
  }

  const closeWindow = (windowId: string) => {
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
            height: window.minimized ? (window.lastRect?.height ?? window.height) : 42,
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
      setWindows(prev => prev.map(window => {
        if (window.id !== windowId) return window
        if (mode === "drag") {
          const minX = -window.width + 140
          const maxX = canvasRect.width - 120
          const minY = 0
          const maxY = canvasRect.height - 44
          return {
            ...window,
            x: clamp(origin.x + dx, minX, maxX),
            y: clamp(origin.y + dy, minY, maxY),
          }
        }

        const nextWidth = clamp(origin.width + dx, 360, canvasRect.width - window.x + window.width - 120)
        const nextHeight = clamp(origin.height + dy, 220, canvasRect.height - window.y + window.height - 60)
        return {
          ...window,
          width: nextWidth,
          height: nextHeight,
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
          x: clamp(window.x, -window.width + 140, rect.width - 120),
          y: clamp(window.y, 0, rect.height - 44),
        }
      }))
    }
    adjust()
    window.addEventListener("resize", adjust)
    return () => window.removeEventListener("resize", adjust)
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-[#17181c] text-default">
      <main ref={canvasRef} className="dotted-grid relative h-full w-full overflow-hidden bg-[#17181c]">
        {windows
          .filter(window => !window.hidden)
          .sort((a, b) => a.z - b.z)
          .map(window => {
            const agent = getAgent(window.agentId)
            const active = activeWindowId === window.id

            return (
              <section
                key={window.id}
                className={cn(
                  "absolute overflow-hidden rounded-[24px] border bg-[#1f2430] shadow-2xl shadow-black/35 transition-shadow",
                  active ? "border-white/28" : "border-white/14",
                )}
                style={{
                  left: window.x,
                  top: window.y,
                  width: window.width,
                  height: window.minimized ? 42 : window.height,
                  zIndex: window.z,
                }}
                onMouseDown={() => focusWindow(window.id)}
              >
                <div
                  className="flex h-[42px] items-center gap-2 border-b border-white/8 bg-white/[0.035] px-4"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    focusWindow(window.id)
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

                  <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate font-mono text-[12px] font-medium text-white/92">{agent.name}</span>
                    <span className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", STATUS_TONE[agent.status])}>
                      {agent.status}
                    </span>
                  </div>

                  {agent.badge && (
                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
                      {agent.badge}
                    </div>
                  )}
                  <Bell className="h-3.5 w-3.5 text-white/30" />
                </div>

                {!window.minimized && (
                  <>
                    <div className="relative h-[calc(100%-42px)]">
                      <TerminalViewport
                        agent={agent}
                        active={active}
                        onActivate={() => focusWindow(window.id)}
                      />
                    </div>

                    {!window.maximized && (
                      <button
                        type="button"
                        className="absolute bottom-0 right-0 h-7 w-7 cursor-se-resize bg-gradient-to-br from-transparent to-white/[0.08]"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          focusWindow(window.id)
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
