"use client"

import { useState, useEffect, useRef, useCallback, Component, type ReactNode } from "react"
import { useMutation } from "@apollo/client/react"
import { cn } from "@/lib/utils"
import { CREATE_VNC_TOKEN } from "@/lib/graphql/mutations/vnc"
import { useHardRestartAgent } from "@/lib/graphql/hooks/use-agents"
import { createLogger } from "@/lib/logger"
import type { Agent } from "@/lib/types"

const log = createLogger("vnc")
const VIEWPORT_STYLE = { width: "100%", height: "100%", position: "absolute", inset: 0 } as const
const TOKEN_REUSE_WINDOW_MS = 45_000

class VncErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch() {}
  render() { return this.state.hasError ? null : this.props.children }
}

export interface VncThumbnailProps {
  agent: Agent
}

const CLOSE_MESSAGES: Record<number, string> = {
  4002: "Desktop not ready — VNC server starting",
  4004: "Agent not found",
}

const REFRESH_TOKEN_CODES: Set<number> = new Set([4001, 4003])
const CONTAINER_ALIVE: Set<string> = new Set(["running", "idle", "waiting"])

type ConnectionState = "idle" | "fetching-token" | "connecting" | "connected" | "error"

function buildVncWsUrl(agentId: string, token: string): string {
  const { hostname, port, protocol } = window.location
  const wsProto = protocol === "https:" ? "wss" : "ws"
  const host = !port || port === "80" || port === "443" ? hostname : `${hostname}:8000`
  return `${wsProto}://${host}/ws/vnc/${agentId}/?token=${token}`
}

export function VncThumbnail({ agent }: VncThumbnailProps) {
  const hasContainer = CONTAINER_ALIVE.has(agent.lifecycleStatus)
  const isStopped = agent.lifecycleStatus === "stopped"
  const hardRestartAgent = useHardRestartAgent()

  const [connState, setConnState] = useState<ConnectionState>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [createVncToken] = useMutation<{ createVncToken: { token: string } }>(CREATE_VNC_TOKEN)

  const [VncScreen, setVncScreen] = useState<React.ComponentType<any> | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const [viewerActive, setViewerActive] = useState(false)
  const vncRef = useRef<any>(null)
  const retryCountRef = useRef(0)
  const mountedRef = useRef(true)
  const connectingRef = useRef(false)
  const connectedAtRef = useRef(0)
  const tokenIssuedAtRef = useRef(0)

  const agentRef = useRef(agent)
  agentRef.current = agent
  const hasContainerRef = useRef(hasContainer)
  hasContainerRef.current = hasContainer
  const connStateRef = useRef(connState)
  connStateRef.current = connState
  const createVncTokenRef = useRef(createVncToken)
  createVncTokenRef.current = createVncToken

  useEffect(() => {
    import("react-vnc").then((mod) => {
      setVncScreen(() => mod.VncScreen)
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

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
    const { id, name } = agentRef.current
    log("token.fetch", { agent: id, name })

    try {
      const { data } = await createVncTokenRef.current({ variables: { agentId: id } })
      if (!mountedRef.current) {
        connectingRef.current = false
        return
      }

      const token = data?.createVncToken?.token
      if (!token) {
        log("token.failed", { agent: id, reason: "no token in response" }, "warn")
        connectingRef.current = false
        retryCountRef.current += 1
        const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
        setConnState("idle")
        setTimeout(() => { if (mountedRef.current) fetchTokenAndConnect() }, delay)
        return
      }

      tokenIssuedAtRef.current = Date.now()
      const url = buildVncWsUrl(id, token)
      log("connecting", { agent: id, name })
      setWsUrl(url)
      setConnState("connecting")
    } catch (err: any) {
      if (!mountedRef.current) {
        connectingRef.current = false
        return
      }
      log("token.error", { agent: id, error: err.message }, "warn")
      connectingRef.current = false
      retryCountRef.current += 1
      const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
      setConnState("idle")
      setTimeout(() => { if (mountedRef.current) fetchTokenAndConnect() }, delay)
    }
  }, [])

  useEffect(() => {
    if (hasContainer) {
      setViewerActive(true)
      if (!wsUrl && connStateRef.current === "idle") {
        retryCountRef.current = 0
        fetchTokenAndConnect()
      }
      return
    }

    const timer = setTimeout(() => {
      if (hasContainerRef.current) return
      const a = agentRef.current
      log("cleanup", { agent: a.id, lifecycle: a.lifecycleStatus, relay: a.relayConnected })
      setViewerActive(false)
      setWsUrl(null)
      setConnState("idle")
      setErrorMsg(null)
      retryCountRef.current = 0
      connectingRef.current = false
      tokenIssuedAtRef.current = 0
      const ref = vncRef.current
      vncRef.current = null
      if (ref) {
        setTimeout(() => { try { ref.disconnect() } catch {} }, 0)
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [fetchTokenAndConnect, hasContainer, wsUrl])

  const handleConnect = useCallback(() => {
    if (!mountedRef.current) return
    connectingRef.current = false
    connectedAtRef.current = Date.now()
    const { id, name } = agentRef.current
    log("connected", { agent: id, name })
    setConnState("connected")
  }, [])

  const reconnectCurrentUrl = useCallback(() => {
    if (!mountedRef.current || !hasContainerRef.current || !wsUrl) return
    log("reconnecting.same_url", { agent: agentRef.current.id })
    setConnState("connecting")
  }, [wsUrl])

  const handleDisconnect = useCallback((e: any) => {
    connectingRef.current = false
    vncRef.current = null
    const currentHasContainer = hasContainerRef.current
    const a = agentRef.current

    if (!mountedRef.current || !currentHasContainer) {
      if (mountedRef.current && !currentHasContainer) {
        let msg = "Desktop disconnected"
        if (a.lifecycleStatus === "stopped") msg = "Desktop stopped — session ended"
        else if (a.lifecycleStatus === "error") msg = "Desktop lost — agent errored"
        else if (a.lifecycleStatus === "deploying") msg = "Desktop not ready yet"
        else if (!a.relayConnected) msg = "Desktop lost — relay disconnected"
        else msg = "Desktop closed"
        log("disconnected.final", { agent: a.id, message: msg })
        setWsUrl(null)
        setConnState("error")
        setErrorMsg(msg)
      }
      connectedAtRef.current = 0
      return
    }

    const detail = e?.detail ?? e
    const clean = detail?.clean ?? false
    const code = detail?.code

    log("disconnected", { agent: a.id, clean, code, lifecycle: a.lifecycleStatus }, clean ? "debug" : "warn")

    if (!a.relayConnected && CONTAINER_ALIVE.has(a.lifecycleStatus)) {
      log("disconnected.hold_frame", { agent: a.id, lifecycle: a.lifecycleStatus })
      return
    }

    const permanentMsg = code ? CLOSE_MESSAGES[code] : null
    if (permanentMsg) {
      setWsUrl(null)
      setConnState("error")
      setErrorMsg(permanentMsg)
      connectedAtRef.current = 0
      return
    }

    const wasStable = connectedAtRef.current > 0 && (Date.now() - connectedAtRef.current) > 10_000
    if (wasStable) retryCountRef.current = 0
    connectedAtRef.current = 0
    retryCountRef.current += 1
    const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
    const tokenFresh = Boolean(wsUrl) && (Date.now() - tokenIssuedAtRef.current) < TOKEN_REUSE_WINDOW_MS
    const shouldRefreshToken = code !== undefined && REFRESH_TOKEN_CODES.has(code)

    log("reconnecting", {
      agent: a.id,
      attempt: retryCountRef.current,
      code,
      delay,
      strategy: shouldRefreshToken || !tokenFresh ? "fresh_token" : "reuse_url",
    })
    setConnState("idle")

    setTimeout(() => {
      if (!mountedRef.current || !hasContainerRef.current) return
      if (!shouldRefreshToken && tokenFresh) {
        reconnectCurrentUrl()
        return
      }
      setWsUrl(null)
      fetchTokenAndConnect()
    }, delay)
  }, [fetchTokenAndConnect, reconnectCurrentUrl, wsUrl])

  const showVnc = viewerActive && VncScreen && wsUrl && (connState === "connecting" || connState === "connected")
  const showRuntimeFallback =
    !hasContainer &&
    (connState === "error" || agent.lifecycleStatus === "error" || isStopped)

  useEffect(() => {
    if (!showVnc) return
    const raf = requestAnimationFrame(() => {
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
    <div className="overflow-hidden bg-surface flex flex-col">
      <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
        {showVnc ? (
          <VncErrorBoundary key={wsUrl}>
            <VncScreen
              ref={vncRef}
              url={wsUrl}
              autoConnect={false}
              scaleViewport
              background="var(--p-surface, #1e1e1e)"
              style={VIEWPORT_STYLE}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          </VncErrorBoundary>
        ) : (
          <div className="absolute inset-0 flex flex-col">
            <div className="h-4 bg-surface-sunken flex items-center px-2 gap-1 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-danger/60" />
              <span className="h-1.5 w-1.5 rounded-full bg-warning/60" />
              <span className="h-1.5 w-1.5 rounded-full bg-success/60" />
              <span className="ml-2 text-[7px] text-muted/40 font-mono truncate">
                {agent.name} — {hasContainer ? agent.task : isStopped ? "session ended" : agent.lifecycleStatus}
              </span>
            </div>
            <div className="flex-1 bg-surface p-1.5 flex items-center justify-center">
              {connState === "fetching-token" || connState === "connecting" || (connState === "idle" && hasContainer) ? (
                <div className="flex flex-col items-center gap-1">
                  <span className="h-3 w-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                  <span className="text-[7px] font-mono text-muted/40">connecting...</span>
                </div>
              ) : showRuntimeFallback ? (
                <div className="flex w-full max-w-[14rem] flex-col items-center gap-2 rounded-md border border-white/6 bg-surface-sunken/70 px-3 py-2 text-center">
                  <span className="text-[8px] font-mono text-muted/60">
                    {isStopped ? "session ended" : "preview unavailable"}
                  </span>
                  <span className="text-[7px] text-muted/45">
                    {errorMsg || agent.errorMessage || "The runtime is no longer available."}
                  </span>
                  <div className="flex gap-3 text-[7px] font-mono text-muted/35">
                    <span>{`$${agent.cost.toFixed(2)}`}</span>
                    <span>{agent.duration}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => hardRestartAgent(agent.id)}
                    className="rounded border border-accent/25 bg-accent/10 px-2 py-1 text-[7px] font-mono uppercase tracking-[0.18em] text-accent transition hover:bg-accent/15"
                  >
                    Redeploy
                  </button>
                </div>
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
