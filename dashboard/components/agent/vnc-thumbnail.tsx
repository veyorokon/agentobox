"use client"

import { useState, useEffect, useRef, useCallback, Component, type ReactNode } from "react"
import { useMutation } from "@apollo/client/react"
import { cn } from "@/lib/utils"
import { CREATE_VNC_TOKEN } from "@/lib/graphql/mutations/vnc"
import { createLogger } from "@/lib/logger"
import type { Agent } from "@/lib/types"

const log = createLogger("vnc")

/** Swallow react-vnc's internal "disconnected RFB" errors on unmount. */
class VncErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch() {} // intentional: react-vnc throws on unmount when RFB is already disconnected — harmless
  render() { return this.state.hasError ? null : this.props.children }
}

export interface VncThumbnailProps {
  agent: Agent
}

/** Map VNC proxy close codes to user-facing messages (permanent errors only). */
const CLOSE_MESSAGES: Record<number, string> = {
  4002: "Desktop not ready — VNC server starting",
  4004: "Agent not found",
}

/** Codes that are transient during container startup — retry instead of giving up. */
const TRANSIENT_CODES: Set<number> = new Set([4003])

/** Derive the VNC WebSocket URL from current browser hostname. */
function buildVncWsUrl(agentId: string, token: string): string {
  const { hostname, port, protocol } = window.location
  const wsProto = protocol === "https:" ? "wss" : "ws"
  const host = !port || port === "80" || port === "443"
    ? hostname
    : `${hostname}:8000`
  return `${wsProto}://${host}/ws/vnc/${agentId}/?token=${token}`
}

/** Lifecycle states where the agent container is alive and VNC is reachable. */
const CONTAINER_ALIVE: Set<string> = new Set(["running", "idle", "waiting"])

type ConnectionState = "idle" | "fetching-token" | "connecting" | "connected" | "error"

/** VNC live desktop viewer — connects to agent's desktop via noVNC proxy. */
export function VncThumbnail({ agent }: VncThumbnailProps) {
  const hasContainer = CONTAINER_ALIVE.has(agent.lifecycleStatus) && agent.relayConnected
  const isStopped = agent.lifecycleStatus === "stopped"

  const [connState, setConnState] = useState<ConnectionState>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [createVncToken] = useMutation<{ createVncToken: { token: string } }>(CREATE_VNC_TOKEN)

  const [VncScreen, setVncScreen] = useState<React.ComponentType<any> | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const vncRef = useRef<any>(null)
  const retryCountRef = useRef(0)
  const mountedRef = useRef(true)
  const connectingRef = useRef(false)

  // Dynamic import of react-vnc (browser-only APIs)
  useEffect(() => {
    import("react-vnc").then((mod) => {
      setVncScreen(() => mod.VncScreen)
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Suppress noVNC's "disconnected RFB" errors — thrown in event handlers
  // when a WebSocket drops, unreachable by React error boundaries.
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (e.message?.includes("disconnected RFB") || e.message?.includes("changing state")) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return true
      }
    }
    window.addEventListener("error", handler, true)
    return () => window.removeEventListener("error", handler, true)
  }, [])

  const fetchTokenAndConnect = useCallback(async () => {
    if (!mountedRef.current || connectingRef.current) return
    connectingRef.current = true
    setConnState("fetching-token")
    setErrorMsg(null)
    log("token.fetch", { agent: agent.id, name: agent.name })

    try {
      const { data } = await createVncToken({ variables: { agentId: agent.id } })
      if (!mountedRef.current) { connectingRef.current = false; return }

      const token = data?.createVncToken?.token
      if (!token) {
        log("token.failed", { agent: agent.id, reason: "no token in response" }, "warn")
        connectingRef.current = false
        // Retry — token generation can fail transiently during container startup
        retryCountRef.current += 1
        const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
        setConnState("idle")
        setTimeout(() => { if (mountedRef.current) fetchTokenAndConnect() }, delay)
        return
      }

      const url = buildVncWsUrl(agent.id, token)
      log("connecting", { agent: agent.id, name: agent.name })
      setWsUrl(url)
      setConnState("connecting")
      // connectingRef stays true until onConnect or onDisconnect
    } catch (err: any) {
      if (!mountedRef.current) { connectingRef.current = false; return }
      log("token.error", { agent: agent.id, error: err.message }, "warn")
      connectingRef.current = false
      // Retry — network errors, backend restarts, etc. are transient
      retryCountRef.current += 1
      const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
      setConnState("idle")
      setTimeout(() => { if (mountedRef.current) fetchTokenAndConnect() }, delay)
    }
  }, [agent.id, agent.name, createVncToken])

  // Single entry point: connect when container becomes alive
  useEffect(() => {
    if (hasContainer && connState === "idle") {
      retryCountRef.current = 0
      fetchTokenAndConnect()
    }
    if (!hasContainer) {
      log("cleanup", { agent: agent.id, lifecycle: agent.lifecycleStatus, relay: agent.relayConnected })
      // Clear URL first to unmount VncScreen, THEN null the ref.
      // This order prevents "Tried changing state of a disconnected RFB"
      // because VncScreen unmounts before we touch the RFB object.
      setWsUrl(null)
      setConnState("idle")
      setErrorMsg(null)
      retryCountRef.current = 0
      connectingRef.current = false
      // Defer disconnect to next tick — let React unmount VncScreen first
      const ref = vncRef.current
      vncRef.current = null
      if (ref) {
        setTimeout(() => { try { ref.disconnect() } catch {} }, 0)
      }
    }
  }, [hasContainer]) // eslint-disable-line react-hooks/exhaustive-deps

  const connectedAtRef = useRef(0)

  const handleConnect = useCallback(() => {
    if (!mountedRef.current) return
    connectingRef.current = false
    connectedAtRef.current = Date.now()
    log("connected", { agent: agent.id, name: agent.name })
    setConnState("connected")
  }, [agent.id, agent.name])

  const handleDisconnect = useCallback((e: any) => {
    connectingRef.current = false
    // Null out ref immediately — RFB is already disconnected, prevent stale ops
    vncRef.current = null
    connectedAtRef.current = 0
    if (!mountedRef.current || !hasContainer) return

    const detail = e?.detail ?? e
    const clean = detail?.clean ?? false
    const code = detail?.code

    log("disconnected", { agent: agent.id, clean, code, lifecycle: agent.lifecycleStatus }, clean ? "debug" : "warn")

    const permanentMsg = code ? CLOSE_MESSAGES[code] : null
    if (permanentMsg) {
      setWsUrl(null)
      setConnState("error")
      setErrorMsg(permanentMsg)
      return
    }

    // Always retry while the container is alive — never give up on a running agent.
    // The VNC server is running, WS drops are transient (token expiry, network blip,
    // docker compose restart). Exponential backoff caps at 30s between attempts.
    // Only reset retry counter if connection was stable (>10s) — prevents rapid
    // cycling when connections flap (e.g. backend restart, proxy timeout).
    if (hasContainer) {
      const wasStable = connectedAtRef.current > 0 && (Date.now() - connectedAtRef.current) > 10_000
      if (wasStable) retryCountRef.current = 0
      retryCountRef.current += 1
      const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
      log("reconnecting", { agent: agent.id, attempt: retryCountRef.current, code, delay })
      setWsUrl(null)
      setConnState("idle")
      setTimeout(() => {
        if (mountedRef.current && hasContainer) fetchTokenAndConnect()
      }, delay)
      return
    }

    // Container is gone — show appropriate final state
    let msg = "Desktop disconnected"
    if (agent.lifecycleStatus === "stopped") msg = "Desktop stopped — session ended"
    else if (agent.lifecycleStatus === "error") msg = "Desktop lost — agent errored"
    else if (agent.lifecycleStatus === "deploying") msg = "Desktop not ready yet"
    else if (!agent.relayConnected) msg = "Desktop lost — relay disconnected"
    else msg = "Desktop closed"

    log("disconnected.final", { agent: agent.id, message: msg })
    setWsUrl(null)
    setConnState("error")
    setErrorMsg(msg)
  }, [hasContainer, agent.id, agent.lifecycleStatus, agent.relayConnected, fetchTokenAndConnect])

  const showVnc = hasContainer && VncScreen && wsUrl && (connState === "connecting" || connState === "connected")

  // Imperatively connect after VncScreen mounts.
  // autoConnect={false} prevents react-vnc from creating a WebSocket in its
  // internal useEffect — which React strict mode would immediately tear down.
  // Instead we connect via ref after the strict mode mount/unmount/remount
  // cycle settles (rAF fires after the final commit, not during cleanup).
  useEffect(() => {
    if (!showVnc) return
    const raf = requestAnimationFrame(() => {
      // Suppress noVNC's "requires a secure context (TLS)" console warning —
      // expected in local dev (http://localhost), harmless, distracting in logs.
      const origWarn = console.warn
      console.warn = (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].includes("secure context")) return
        origWarn.apply(console, args)
      }
      try { vncRef.current?.connect() } catch {}
      console.warn = origWarn
    })
    return () => cancelAnimationFrame(raf)
  }, [showVnc])

  return (
    <div
      className={cn(
        "overflow-hidden bg-surface flex flex-col",
        isStopped && "opacity-50",
      )}
    >
      {/* VNC viewport -- 16:9 matches agent desktop (1920×1080) */}
      <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
        {showVnc ? (
          <VncErrorBoundary key={wsUrl}>
            <VncScreen
              ref={vncRef}
              url={wsUrl}
              autoConnect={false}
              scaleViewport
              resizeSession
              background="var(--p-surface, #1e1e1e)"
              style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          </VncErrorBoundary>
        ) : (
          <div className="absolute inset-0 flex flex-col">
            {/* Title bar */}
            <div className="h-4 bg-surface-sunken flex items-center px-2 gap-1 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-danger/60" />
              <span className="h-1.5 w-1.5 rounded-full bg-warning/60" />
              <span className="h-1.5 w-1.5 rounded-full bg-success/60" />
              <span className="ml-2 text-[7px] text-muted/40 font-mono truncate">
                {agent.name} — {hasContainer ? agent.task : isStopped ? "session ended" : agent.lifecycleStatus}
              </span>
            </div>
            {/* Status content */}
            <div className="flex-1 bg-surface p-1.5 flex items-center justify-center">
              {connState === "fetching-token" || connState === "connecting" || (connState === "idle" && hasContainer) ? (
                <div className="flex flex-col items-center gap-1">
                  <span className="h-3 w-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                  <span className="text-[7px] font-mono text-muted/40">connecting...</span>
                </div>
              ) : connState === "error" && errorMsg ? (
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-[7px] font-mono text-muted/40">{errorMsg}</span>
                </div>
              ) : isStopped ? (
                <span className="text-[7px] font-mono text-muted/20">session ended</span>
              ) : agent.lifecycleStatus === "error" ? (
                <span className="text-[6px] font-mono text-danger/50 line-clamp-3 text-center px-1">
                  {agent.errorMessage
                    ? agent.errorMessage.split("\n").pop()?.slice(0, 120)
                    : `Process exited (${agent.task || "unknown error"})`}
                </span>
              ) : (
                <span className="text-[7px] font-mono text-muted/25">{agent.lifecycleStatus}</span>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
