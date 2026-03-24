"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bell,
  Circle,
  Command,
  FolderKanban,
  Minus,
  Plus,
  Search,
  Send,
  Settings2,
  UserRound,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

type AgentSeed = {
  id: string
  name: string
  status: "active" | "running" | "blocked" | "idle"
  badge?: string
  lines: string[]
}

type TerminalWindow = {
  id: string
  agentId: string
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  maximized: boolean
  lastRect?: { x: number; y: number; width: number; height: number }
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
  },
  {
    id: "ops-1",
    name: "@ops-1",
    status: "idle",
    lines: [
      "[deploy] latest dev run queued",
      "[watch] waiting for deploy-dev green",
      "> gh run list --branch dev --limit 3",
    ],
  },
  {
    id: "research-1",
    name: "@research-1",
    status: "running",
    lines: [
      "[research] comparing terminal primitives",
      "- freeform windows",
      "- grid layout",
      "- embedded terminal engines",
      "[summary] prefer terminal-first window canvas",
    ],
  },
]

const STATUS_STYLES: Record<AgentSeed["status"], string> = {
  active: "text-success",
  running: "text-info",
  blocked: "text-warning",
  idle: "text-muted",
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function agentById(agentId: string) {
  return AGENTS.find(agent => agent.id === agentId) ?? AGENTS[0]!
}

function terminalPrompt(agent: AgentSeed) {
  switch (agent.status) {
    case "active":
      return "[lead]"
    case "running":
      return "[run]"
    case "blocked":
      return "[wait]"
    default:
      return "[idle]"
  }
}

export function TerminalWorkbenchPrototype({ projectName }: { projectName: string }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const windowsRef = useRef<TerminalWindow[]>([])
  const nextZRef = useRef(4)

  const [search, setSearch] = useState("")
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(["@team-lead"])
  const [chatText, setChatText] = useState("")
  const [windows, setWindows] = useState<TerminalWindow[]>([
    { id: "win-team-lead", agentId: "team-lead", x: 40, y: 32, width: 560, height: 330, z: 1, minimized: false, maximized: false },
    { id: "win-builder-1", agentId: "builder-1", x: 460, y: 120, width: 500, height: 300, z: 2, minimized: false, maximized: false },
    { id: "win-qa-1", agentId: "qa-1", x: 150, y: 390, width: 470, height: 260, z: 3, minimized: false, maximized: false },
  ])
  const [paletteDrag, setPaletteDrag] = useState<{ agentId: string; x: number; y: number } | null>(null)

  useEffect(() => {
    windowsRef.current = windows
  }, [windows])

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return AGENTS
    return AGENTS.filter(agent => agent.name.toLowerCase().includes(q) || agent.status.includes(q))
  }, [search])

  const selectedTargets = useMemo(
    () => AGENTS.filter(agent => selectedAgentIds.includes(agent.name)),
    [selectedAgentIds],
  )

  const minimizedWindows = windows
    .filter(window => window.minimized)
    .sort((a, b) => a.z - b.z)

  const focusWindow = (windowId: string) => {
    setWindows(prev => prev.map(window => (
      window.id === windowId
        ? { ...window, z: nextZRef.current++ }
        : window
    )))
  }

  const computeOpenRect = (drop?: { x: number; y: number }) => {
    const canvas = canvasRef.current
    const canvasWidth = canvas?.clientWidth ?? 1200
    const canvasHeight = canvas?.clientHeight ?? 680
    const existing = windowsRef.current.filter(window => !window.minimized).length
    const width = 520
    const height = 310

    if (drop) {
      return {
        x: clamp(drop.x - width / 2, 16, Math.max(16, canvasWidth - width - 16)),
        y: clamp(drop.y - 18, 16, Math.max(16, canvasHeight - height - 16)),
        width,
        height,
      }
    }

    return {
      x: clamp(32 + existing * 28, 16, Math.max(16, canvasWidth - width - 16)),
      y: clamp(24 + existing * 24, 16, Math.max(16, canvasHeight - height - 16)),
      width,
      height,
    }
  }

  const openAgentWindow = (agentId: string, drop?: { x: number; y: number }) => {
    const agent = agentById(agentId)
    setSelectedAgentIds(prev => prev.includes(agent.name) ? prev : [...prev, agent.name])
    setWindows(prev => {
      const existing = prev.find(window => window.agentId === agentId)
      if (existing) {
        return prev.map(window => (
          window.id === existing.id
            ? {
                ...window,
                minimized: false,
                ...(drop ? computeOpenRect(drop) : {}),
                z: nextZRef.current++,
              }
            : window
        ))
      }
      return [
        ...prev,
        {
          id: `win-${agentId}`,
          agentId,
          ...computeOpenRect(drop),
          z: nextZRef.current++,
          minimized: false,
          maximized: false,
        },
      ]
    })
  }

  const minimizeWindow = (windowId: string) => {
    setWindows(prev => prev.map(window => (
      window.id === windowId ? { ...window, minimized: true } : window
    )))
  }

  const closeWindow = (windowId: string) => {
    setWindows(prev => prev.filter(window => window.id !== windowId))
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
          z: nextZRef.current++,
        }
      }
      return {
        ...window,
        x: 12,
        y: 12,
        width: Math.max(480, canvas.clientWidth - 24),
        height: Math.max(280, canvas.clientHeight - 24),
        maximized: true,
        lastRect: { x: window.x, y: window.y, width: window.width, height: window.height },
        z: nextZRef.current++,
      }
    }))
  }

  const beginWindowPointerSession = (
    mode: "drag" | "resize",
    windowId: string,
    startX: number,
    startY: number,
  ) => {
    const canvas = canvasRef.current
    const target = windowsRef.current.find(window => window.id === windowId)
    if (!canvas || !target || target.maximized) return

    const canvasRect = canvas.getBoundingClientRect()
    const origin = { x: target.x, y: target.y, width: target.width, height: target.height }

    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      setWindows(prev => prev.map(window => {
        if (window.id !== windowId) return window
        if (mode === "drag") {
          return {
            ...window,
            x: clamp(origin.x + dx, 0, Math.max(0, canvasRect.width - window.width)),
            y: clamp(origin.y + dy, 0, Math.max(0, canvasRect.height - window.height)),
          }
        }
        return {
          ...window,
          width: clamp(origin.width + dx, 320, Math.max(320, canvasRect.width - window.x)),
          height: clamp(origin.height + dy, 220, Math.max(220, canvasRect.height - window.y)),
        }
      }))
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  const beginPaletteDrag = (agentId: string, startX: number, startY: number) => {
    setPaletteDrag({ agentId, x: startX, y: startY })

    const onMove = (event: PointerEvent) => {
      setPaletteDrag({ agentId, x: event.clientX, y: event.clientY })
    }

    const onUp = (event: PointerEvent) => {
      const canvas = canvasRef.current
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        if (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        ) {
          openAgentWindow(agentId, { x: event.clientX - rect.left, y: event.clientY - rect.top })
        }
      }
      setPaletteDrag(null)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  return (
    <div className="h-screen overflow-hidden bg-surface text-default">
      <div className="flex h-full flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-border-default bg-surface-raised px-3">
          <div className="text-sm font-semibold tracking-wide text-default">Agentobox</div>
          <div className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11px] text-muted">
            {projectName || "Workbench Prototype"}
          </div>
          <div className="ml-2 flex min-w-[280px] items-center gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[11px] text-muted">
            <Command className="h-3 w-3" />
            <span>/ command</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-[11px] text-secondary hover:bg-surface-raised">
              <FolderKanban className="h-3 w-3" />
              New task
            </button>
            <button className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-[11px] text-secondary hover:bg-surface-raised">
              <Send className="h-3 w-3" />
              Team-lead
            </button>
            <button className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-[11px] text-secondary hover:bg-surface-raised">
              <Settings2 className="h-3 w-3" />
              Settings
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle bg-surface text-[11px] font-semibold text-default">
              V
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="w-[248px] shrink-0 border-r border-border-default bg-surface-raised/60 p-3">
            <div className="mb-3 flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search agents..."
                className="w-full bg-transparent text-[12px] text-default outline-none placeholder:text-muted"
              />
            </div>

            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Agents</div>
              <button
                type="button"
                onClick={() => selectedAgentIds.forEach(target => {
                  const agent = AGENTS.find(item => item.name === target)
                  if (agent) openAgentWindow(agent.id)
                })}
                className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 py-1 text-[10px] text-secondary hover:bg-surface-raised"
              >
                <Plus className="h-3 w-3" />
                Open selected
              </button>
            </div>

            <div className="space-y-2">
              {filteredAgents.map(agent => {
                const checked = selectedAgentIds.includes(agent.name)
                return (
                  <div
                    key={agent.id}
                    onPointerDown={(event) => {
                      if (event.target instanceof HTMLInputElement) return
                      beginPaletteDrag(agent.id, event.clientX, event.clientY)
                    }}
                    className="rounded-lg border border-border-subtle bg-surface px-2.5 py-2 text-left transition-colors hover:border-border-default hover:bg-surface-raised"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedAgentIds(prev => (
                          checked ? prev.filter(id => id !== agent.name) : [...prev, agent.name]
                        ))}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-border-default bg-surface"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Circle className={cn("h-2.5 w-2.5 fill-current", STATUS_STYLES[agent.status])} />
                          <span className="truncate text-[12px] font-medium text-default">{agent.name}</span>
                        </div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted">
                          {agent.status}
                        </div>
                        {agent.badge && (
                          <div className="mt-1 text-[10px] text-accent">{agent.badge}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          <main className="relative flex min-w-0 flex-1 flex-col">
            <div
              ref={canvasRef}
              className="dotted-grid relative min-h-0 flex-1 overflow-hidden bg-surface-backdrop/35"
            >
              {windows
                .filter(window => !window.minimized)
                .sort((a, b) => a.z - b.z)
                .map(window => {
                  const agent = agentById(window.agentId)
                  return (
                    <section
                      key={window.id}
                      onPointerDown={() => focusWindow(window.id)}
                      className="absolute overflow-hidden rounded-2xl border border-border-strong bg-[#1f2430] text-[#d7dce4] shadow-2xl shadow-black/30"
                      style={{
                        left: window.x,
                        top: window.y,
                        width: window.width,
                        height: window.height,
                        zIndex: window.z,
                      }}
                    >
                      <div
                        onPointerDown={(event) => {
                          focusWindow(window.id)
                          beginWindowPointerSession("drag", window.id, event.clientX, event.clientY)
                        }}
                        className="flex h-11 items-center gap-2 border-b border-white/8 bg-white/4 px-3"
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
                          className="h-3.5 w-3.5 rounded-full bg-[#ffbd2e] transition-transform hover:scale-110"
                          title="Minimize"
                        >
                          <Minus className="mx-auto h-2 w-2 text-black/55" />
                        </button>
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleMaximize(window.id)
                          }}
                          className="h-3.5 w-3.5 rounded-full bg-[#27c93f] transition-transform hover:scale-110"
                          title={window.maximized ? "Restore" : "Focus"}
                        />
                        <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate font-mono text-[12px] font-medium text-white/90">{agent.name}</span>
                          <span className={cn("text-[10px] uppercase tracking-[0.16em]", STATUS_STYLES[agent.status])}>
                            {agent.status}
                          </span>
                        </div>
                        {agent.badge && (
                          <div className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] text-white/65">
                            {agent.badge}
                          </div>
                        )}
                        <Bell className="h-3.5 w-3.5 text-white/35" />
                      </div>

                      <div className="h-[calc(100%-44px)] overflow-auto px-5 py-4 font-mono text-[13px] leading-6">
                        <div className="mb-4 text-white/45">
                          Last activity: just now
                        </div>
                        {agent.lines.map((line, index) => (
                          <div key={`${window.id}-${index}`} className="whitespace-pre-wrap text-white/88">
                            {line}
                          </div>
                        ))}
                        <div className="mt-3 flex items-center gap-2 text-[#8ad17a]">
                          <span>{terminalPrompt(agent)}</span>
                          <span className="h-4 w-2 bg-white/80 animate-pulse" />
                        </div>
                      </div>

                      {!window.maximized && (
                        <button
                          type="button"
                          onPointerDown={(event) => {
                            event.stopPropagation()
                            focusWindow(window.id)
                            beginWindowPointerSession("resize", window.id, event.clientX, event.clientY)
                          }}
                          className="absolute bottom-0 right-0 h-6 w-6 cursor-se-resize bg-gradient-to-br from-transparent via-white/0 to-white/10"
                          aria-label="Resize terminal"
                        />
                      )}
                    </section>
                  )
                })}

              {windows.filter(window => !window.minimized).length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-2xl border border-dashed border-border-default bg-surface/80 px-6 py-5 text-center shadow-sm">
                    <div className="font-mono text-[14px] text-default">Drag agents here to open terminal sessions</div>
                    <div className="mt-2 text-[12px] text-muted">Treat the canvas like a browser full of terminals, not a feed wall.</div>
                  </div>
                </div>
              )}

              {paletteDrag && (
                <div
                  className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-[#1f2430] px-3 py-2 font-mono text-[12px] text-white shadow-2xl"
                  style={{ left: paletteDrag.x, top: paletteDrag.y }}
                >
                  {agentById(paletteDrag.agentId).name}
                </div>
              )}
            </div>

            <div className="border-t border-border-default bg-surface-raised/80 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Dock</div>
                {minimizedWindows.length === 0 && (
                  <div className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11px] text-muted">
                    No minimized terminals
                  </div>
                )}
                {minimizedWindows.map(window => {
                  const agent = agentById(window.agentId)
                  return (
                    <button
                      key={window.id}
                      type="button"
                      onClick={() => openAgentWindow(window.agentId)}
                      className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11px] text-secondary hover:bg-surface-raised"
                    >
                      {agent.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <footer className="border-t border-border-default bg-surface-raised px-3 py-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Chat / Tasking</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTargets.map(target => (
                    <span
                      key={target.id}
                      className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[11px] text-secondary"
                    >
                      {target.name}
                    </span>
                  ))}
                  {selectedTargets.length === 0 && (
                    <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[11px] text-muted">
                      no targets selected
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-surface text-muted">
                  <UserRound className="h-4 w-4" />
                </div>
                <input
                  value={chatText}
                  onChange={(event) => setChatText(event.target.value)}
                  placeholder="Message selected agents or assign a task..."
                  className="h-10 min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 text-[13px] text-default outline-none placeholder:text-muted"
                />
                <button className="inline-flex h-10 items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-3 text-[12px] font-medium text-accent hover:bg-accent/15">
                  <Send className="h-3.5 w-3.5" />
                  Send
                </button>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  )
}
