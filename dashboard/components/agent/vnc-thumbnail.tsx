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
const MAX_VNC_RETRIES = 5

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

type ConnectionState = "idle" | "fetching-token" | "connecting" | "connected" | "error"

function buildVncWsUrl(agentId: string, token: string): string {
  const { hostname, port, protocol } = window.location
  const wsProto = protocol === "https:" ? "wss" : "ws"
  const host = !port || port === "80" || port === "443" ? hostname : `${hostname}:8000`
  return `${wsProto}://${host}/ws/vnc/${agentId}/?token=${token}`
}

export function VncThumbnail({ agent }: VncThumbnailProps) {
  const previewReady = agent.previewState === "ready"
  const isDeploying = agent.previewState === "deploying" || agent.lifecycleStatus === "deploying"
  const isPreviewError = agent.previewState === "error"
  const isStopped = agent.lifecycleStatus === "stopped"
  const hardRestartAgent = useHardRestartAgent()

  const [connState, setConnState] = useState<ConnectionState>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [createVncToken] = useMutation<{ createVncToken: { token: string } }>(CREATE_VNC_TOKEN)

  const [VncScreen, setVncScreen] = useState<React.ComponentType<any> | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const vncRef = useRef<any>(null)
  const retryCountRef = useRef(0)
  const mountedRef = useRef(true)
  const connectingRef = useRef(false)
  const connectedAtRef = useRef(0)
  const tokenIssuedAtRef = useRef(0)
  const previewRuntimeIdRef = useRef(agent.previewRuntimeId)

  const agentRef = useRef(agent)
  agentRef.current = agent
  const connStateRef = useRef(connState)
  connStateRef.current = connState
  const createVncTokenRef = useRef(createVncToken)
  createVncTokenRef.current = createVncToken

  const exhaustRetryBudget = useCallback((message: string) => {
    log("reconnect.exhausted", {
      agent: agentRef.current.id,
      attempts: retryCountRef.current,
      runtimeId: agentRef.current.previewRuntimeId,
    })
    setWsUrl(null)
    setConnState("error")
    setErrorMsg(message)
    connectingRef.current = false
    connectedAtRef.current = 0
  }, [])

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
    if (!mountedRef.current || connectingRef.current || agentRef.current.previewState !== "ready") return
    if (retryCountRef.current > MAX_VNC_RETRIES) return
    connectingRef.current = true
    setConnState("fetching-token")
    setErrorMsg(null)
    const { id, name, previewRuntimeId } = agentRef.current
    log("token.fetch", { agent: id, name, runtimeId: previewRuntimeId })

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
        if (retryCountRef.current > MAX_VNC_RETRIES) {
          exhaustRetryBudget("Preview connection lost — click to retry")
          return
        }
        const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
        setConnState("idle")
        setTimeout(() => { if (mountedRef.current) fetchTokenAndConnect() }, delay)
        return
      }

      tokenIssuedAtRef.current = Date.now()
      const url = buildVncWsUrl(id, token)
      log("connecting", { agent: id, name, runtimeId: previewRuntimeId })
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
      if (retryCountRef.current > MAX_VNC_RETRIES) {
        exhaustRetryBudget("Preview connection lost — click to retry")
        return
      }
      const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
      setConnState("idle")
      setTimeout(() => { if (mountedRef.current) fetchTokenAndConnect() }, delay)
    }
  }, [exhaustRetryBudget])

  useEffect(() => {
    const previousRuntimeId = previewRuntimeIdRef.current
    if (previousRuntimeId === agent.previewRuntimeId) return

    previewRuntimeIdRef.current = agent.previewRuntimeId
    log("runtime.changed", {
      agent: agent.id,
      previousRuntimeId,
      nextRuntimeId: agent.previewRuntimeId,
      previewState: agent.previewState,
    })

    setWsUrl(null)
    setConnState("idle")
    setErrorMsg(null)
    retryCountRef.current = 0
    connectingRef.current = false
    connectedAtRef.current = 0
    tokenIssuedAtRef.current = 0
    const ref = vncRef.current
    vncRef.current = null
    if (ref) {
      setTimeout(() => { try { ref.disconnect() } catch {} }, 0)
    }
  }, [agent.id, agent.previewRuntimeId, agent.previewState])

  useEffect(() => {
    if (!previewReady) {
      log("preview.unavailable", {
        agent: agent.id,
        previewState: agent.previewState,
        runtimeId: agent.previewRuntimeId,
      })
      setWsUrl(null)
      retryCountRef.current = 0
      connectingRef.current = false
      connectedAtRef.current = 0
      tokenIssuedAtRef.current = 0
      const ref = vncRef.current
      vncRef.current = null
      if (ref) {
        setTimeout(() => { try { ref.disconnect() } catch {} }, 0)
      }
      if (agent.previewState !== "error") {
        setConnState("idle")
        setErrorMsg(null)
      }
      return
    }

    // Auto-recover from error only if retries haven't been exhausted.
    // Circuit-breaker errors (retryCount > MAX) require manual retry.
    if (connStateRef.current === "error" && retryCountRef.current <= MAX_VNC_RETRIES) {
      setConnState("idle")
      setErrorMsg(null)
    }
    if (!wsUrl && connStateRef.current === "idle") {
      retryCountRef.current = 0
      fetchTokenAndConnect()
    }
  }, [agent.id, agent.previewRuntimeId, agent.previewState, fetchTokenAndConnect, previewReady, wsUrl])

  const handleConnect = useCallback(() => {
    if (!mountedRef.current) return
    connectingRef.current = false
    connectedAtRef.current = Date.now()
    const { id, name } = agentRef.current
    log("connected", { agent: id, name })
    setConnState("connected")
  }, [])

  const reconnectCurrentUrl = useCallback(() => {
    if (!mountedRef.current || agentRef.current.previewState !== "ready" || !wsUrl) return
    log("reconnecting.same_url", { agent: agentRef.current.id, runtimeId: agentRef.current.previewRuntimeId })
    setConnState("connecting")
  }, [wsUrl])

  const handleDisconnect = useCallback((e: any) => {
    connectingRef.current = false
    vncRef.current = null
    const a = agentRef.current

    if (!mountedRef.current || a.previewState !== "ready") {
      if (mountedRef.current && a.previewState !== "ready") {
        let msg = "Desktop disconnected"
        if (a.lifecycleStatus === "stopped") msg = "Desktop stopped — session ended"
        else if (a.previewState === "error") msg = "Desktop lost — agent errored"
        else if (a.previewState === "deploying") msg = "Desktop not ready yet"
        else if (a.previewState === "unavailable") msg = "Preview unavailable"
        log("disconnected.final", {
          agent: a.id,
          message: msg,
          previewState: a.previewState,
          runtimeId: a.previewRuntimeId,
        })
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
    const runtimeId = a.previewRuntimeId

    log("disconnected", { agent: a.id, clean, code, previewState: a.previewState, runtimeId }, clean ? "debug" : "warn")

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
    const shouldRefreshToken = code !== undefined && REFRESH_TOKEN_CODES.has(code)

    // Circuit breaker: stop retrying after budget exhausted for same runtime
    if (retryCountRef.current > MAX_VNC_RETRIES) {
      exhaustRetryBudget("Preview connection lost — click to retry")
      return
    }

    // 4001 is a definitive stale-token signal — retry immediately with fresh token
    // instead of spending backoff time on a token that is known bad.
    const immediateRefresh = shouldRefreshToken && retryCountRef.current === 1
    const delay = immediateRefresh ? 0 : Math.min(1000 * Math.pow(1.5, retryCountRef.current - 1), 30000)
    const tokenFresh = Boolean(wsUrl) && (Date.now() - tokenIssuedAtRef.current) < TOKEN_REUSE_WINDOW_MS

    log("reconnecting", {
      agent: a.id,
      attempt: retryCountRef.current,
      code,
      delay,
      strategy: shouldRefreshToken || !tokenFresh ? "fresh_token" : "reuse_url",
    })
    setConnState("idle")

    setTimeout(() => {
      if (!mountedRef.current) return
      if (agentRef.current.previewState !== "ready") return
      if (agentRef.current.previewRuntimeId !== runtimeId) return
      if (!shouldRefreshToken && tokenFresh) {
        reconnectCurrentUrl()
        return
      }
      setWsUrl(null)
      fetchTokenAndConnect()
    }, delay)
  }, [exhaustRetryBudget, fetchTokenAndConnect, reconnectCurrentUrl, wsUrl])

  const manualRetry = useCallback(() => {
    retryCountRef.current = 0
    setConnState("idle")
    setErrorMsg(null)
    setWsUrl(null)
    fetchTokenAndConnect()
  }, [fetchTokenAndConnect])

  // VNC mounts as soon as we have a URL, but stays invisible until connected.
  // This eliminates the black-frame flash during RFB handshake.
  const mountVnc = Boolean(VncScreen && wsUrl && previewReady)
  const vncRevealed = mountVnc && connState === "connected"
  const VncScreenComponent = VncScreen
  const isPreviewDeploying = agent.previewState === "deploying"
  const showRuntimeFallback =
    agent.previewState === "error" || agent.previewState === "unavailable" || isStopped

  // Boot surface only for previewState=deploying (desktop not ready yet).
  // Once previewState=ready, the connecting spinner takes over briefly
  // until VNC connects and cross-fades in.
  const isBooting = isPreviewDeploying && !isPreviewError

  useEffect(() => {
    if (!mountVnc) return
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
  }, [mountVnc])

  return (
    <div className="overflow-hidden bg-surface flex flex-col">
      <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
        {/* VNC layer: mounts early but invisible until connected */}
        {mountVnc && VncScreenComponent && (
          <div
            className="transition-opacity duration-500"
            style={{
              ...VIEWPORT_STYLE,
              opacity: vncRevealed ? 1 : 0,
              pointerEvents: vncRevealed ? "auto" : "none",
            }}
          >
            <VncErrorBoundary key={wsUrl}>
              <VncScreenComponent
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
          </div>
        )}

        {/* Overlay surfaces: boot, error, stopped — cross-fades with VNC */}
        <div
          className="absolute inset-0 flex flex-col transition-opacity duration-500"
          style={{
            opacity: vncRevealed ? 0 : 1,
            pointerEvents: vncRevealed ? "none" : "auto",
          }}
        >
          <div className="flex-1 bg-surface p-1.5 flex items-center justify-center">
              {/* Unified boot surface: deploying → token fetch → connecting → VNC handshake */}
              {isBooting ? (
                <div className="flex flex-col items-center justify-center gap-3 relative overflow-hidden w-full h-full">
                  <style>{`
                    @keyframes abox-scanline {
                      0% { left: -2%; opacity: 0; }
                      3% { opacity: 0.6; }
                      15% { left: 40%; opacity: 0.35; }
                      50% { left: 70%; opacity: 0.2; }
                      90% { left: 95%; opacity: 0.08; }
                      100% { left: 100%; opacity: 0; }
                    }
                    @keyframes abox-scan-wash {
                      0% { opacity: 0; }
                      8% { opacity: 0.04; }
                      40% { opacity: 0.015; }
                      100% { opacity: 0; }
                    }
                    @keyframes abox-blink-soft {
                      0%, 100% { opacity: 0.2; }
                      50% { opacity: 0.7; }
                    }
                    @keyframes abox-fade-in-up {
                      0% { opacity: 0; transform: translateY(4px); }
                      100% { opacity: 1; transform: translateY(0); }
                    }
                  `}</style>
                  {/* Wash — subtle left-side lightening that trails behind the scanline */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: "linear-gradient(90deg, var(--color-accent, #ff7a59) 0%, transparent 60%)",
                      animation: "abox-scan-wash 3.5s ease-out infinite",
                    }}
                  />
                  {/* Scanline — thin vertical line sweeps left to right, fast start, slow finish */}
                  <div
                    className="absolute inset-y-0 pointer-events-none"
                    style={{
                      width: "1px",
                      background: "linear-gradient(180deg, transparent 10%, var(--color-accent, #ff7a59) 50%, transparent 90%)",
                      boxShadow: "0 0 6px 1px var(--color-accent, #ff7a59)",
                      animation: "abox-scanline 3.5s ease-out infinite",
                    }}
                  />
                  <div className="flex items-center gap-1.5 relative" style={{ animation: "abox-fade-in-up 0.6s ease-out both" }}>
                    <span
                      className="h-1 w-1 rounded-full bg-accent/60"
                      style={{ animation: "abox-blink-soft 2.5s ease-in-out infinite" }}
                    />
                    <span className="text-[7px] font-mono text-muted/40 tracking-[0.2em] uppercase">
                      starting desktop
                    </span>
                  </div>
                </div>
              ) : !vncRevealed && previewReady && connState !== "error" ? (
                <div className="flex flex-col items-center gap-1">
                  <span className="h-3 w-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                  <span className="text-[7px] font-mono text-muted/40">connecting...</span>
                </div>
              ) : connState === "error" && previewReady ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[8px] font-mono text-muted/50">{errorMsg || "Preview disconnected"}</span>
                  <button
                    type="button"
                    onClick={manualRetry}
                    className="rounded border border-accent/25 bg-accent/8 px-3 py-1 text-[8px] font-mono text-accent/70 transition hover:bg-accent/15 hover:text-accent"
                  >
                    retry
                  </button>
                </div>
              ) : showRuntimeFallback || isPreviewError ? (
                <div className="flex w-full h-full flex-col font-mono text-[9px]">
                  {/* Status strip */}
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${isStopped ? "bg-muted/40" : "bg-danger/60"}`} />
                      <span className={isStopped ? "text-muted/50" : "text-danger/60"}>
                        {isStopped ? "session ended" : isPreviewError ? "runtime crashed" : "preview unavailable"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted/25">{`$${agent.cost.toFixed(2)}`}</span>
                      <span className="text-muted/25">{agent.duration}</span>
                      {!isStopped && (
                        <button
                          type="button"
                          onClick={() => hardRestartAgent(agent.id)}
                          className="rounded border border-accent/25 bg-accent/8 px-2 py-0.5 text-[8px] text-accent/70 transition hover:bg-accent/15 hover:text-accent"
                        >
                          redeploy
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Diagnostic body */}
                  <div className="flex-1 flex flex-col justify-center px-3 py-2">
                    {(agent.errorMessage || errorMsg) ? (
                      <div className="space-y-1.5">
                        <span className="text-[7px] text-muted/30 uppercase tracking-wider">diagnostics</span>
                        <p className="text-[8px] text-default/50 leading-relaxed line-clamp-5 whitespace-pre-wrap">
                          {agent.errorMessage || errorMsg}
                        </p>
                      </div>
                    ) : (
                      <span className="text-muted/25 text-center">
                        {isStopped
                          ? "session ended cleanly"
                          : isPreviewError
                            ? "container exited — no diagnostics captured"
                            : "preview is not currently available"}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <span className="text-[7px] font-mono text-muted/25">{agent.previewState}</span>
              )}
            </div>
          </div>
        </div>
      </div>
  )
}
