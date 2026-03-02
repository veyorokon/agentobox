"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useMutation } from "@apollo/client"
import { cn } from "@/lib/utils"
import { CREATE_VNC_TOKEN } from "@/lib/graphql/mutations/vnc"
import type { Agent } from "@/lib/types"

export interface VncThumbnailProps {
  agent: Agent
}

/** Map VNC proxy close codes to user-facing messages. */
const CLOSE_MESSAGES: Record<number, string> = {
  4002: "Desktop not available",
  4003: "Cannot reach agent desktop",
  4004: "Agent not found",
}

/** Derive the VNC WebSocket URL from NEXT_PUBLIC_API_URL. */
function buildVncWsUrl(agentId: string, token: string): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/graphql"
  const base = apiUrl.replace(/\/graphql$/, "").replace(/^http/, "ws")
  return `${base}/ws/vnc/${agentId}/?token=${token}`
}

/** Lifecycle states where the agent container is alive and VNC is reachable. */
const CONTAINER_ALIVE: Set<string> = new Set(["running", "idle", "waiting"])

type ConnectionState = "idle" | "fetching-token" | "connecting" | "connected" | "error"

/** VNC live desktop viewer — connects to agent's desktop via noVNC proxy. */
export function VncThumbnail({ agent }: VncThumbnailProps) {
  const hasContainer = CONTAINER_ALIVE.has(agent.lifecycleStatus)
  const isStopped = agent.lifecycleStatus === "stopped"

  const [connState, setConnState] = useState<ConnectionState>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [createVncToken] = useMutation(CREATE_VNC_TOKEN)

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

  const fetchTokenAndConnect = useCallback(async () => {
    if (!mountedRef.current || connectingRef.current) return
    connectingRef.current = true
    setConnState("fetching-token")
    setErrorMsg(null)

    try {
      const { data } = await createVncToken({ variables: { agentId: agent.id } })
      if (!mountedRef.current) { connectingRef.current = false; return }

      const token = data?.createVncToken?.token
      if (!token) {
        setConnState("error")
        setErrorMsg("Failed to get VNC token")
        connectingRef.current = false
        return
      }

      const url = buildVncWsUrl(agent.id, token)
      setWsUrl(url)
      setConnState("connecting")
      // connectingRef stays true until onConnect or onDisconnect
    } catch (err: any) {
      if (!mountedRef.current) { connectingRef.current = false; return }
      setConnState("error")
      setErrorMsg(err.message ?? "Failed to connect")
      connectingRef.current = false
    }
  }, [agent.id, createVncToken])

  // Single entry point: connect when container becomes alive
  useEffect(() => {
    if (hasContainer && connState === "idle") {
      retryCountRef.current = 0
      fetchTokenAndConnect()
    }
    if (!hasContainer) {
      setConnState("idle")
      setWsUrl(null)
      setErrorMsg(null)
      retryCountRef.current = 0
      connectingRef.current = false
    }
  }, [hasContainer]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = useCallback(() => {
    if (!mountedRef.current) return
    connectingRef.current = false
    retryCountRef.current = 0
    setConnState("connected")
  }, [])

  const handleDisconnect = useCallback((e: any) => {
    connectingRef.current = false
    if (!mountedRef.current || !hasContainer) return

    const detail = e?.detail ?? e
    const clean = detail?.clean ?? false
    const code = detail?.code

    const permanentMsg = code ? CLOSE_MESSAGES[code] : null
    if (permanentMsg) {
      setConnState("error")
      setErrorMsg(permanentMsg)
      return
    }

    // Retry on unclean disconnect or expired token (4001)
    if (!clean || code === 4001) {
      retryCountRef.current += 1
      if (retryCountRef.current <= 5) {
        setWsUrl(null)
        setConnState("idle")
        setTimeout(() => {
          if (mountedRef.current && hasContainer) fetchTokenAndConnect()
        }, Math.min(1000 * retryCountRef.current, 5000))
        return
      }
    }

    setConnState("error")
    setErrorMsg("Connection lost")
  }, [hasContainer, fetchTokenAndConnect])

  const showVnc = hasContainer && VncScreen && wsUrl && (connState === "connecting" || connState === "connected")

  // Imperatively connect after VncScreen mounts.
  // autoConnect={false} prevents react-vnc from creating a WebSocket in its
  // internal useEffect — which React strict mode would immediately tear down.
  // Instead we connect via ref after the strict mode mount/unmount/remount
  // cycle settles (rAF fires after the final commit, not during cleanup).
  useEffect(() => {
    if (!showVnc) return
    const raf = requestAnimationFrame(() => {
      vncRef.current?.connect()
    })
    return () => cancelAnimationFrame(raf)
  }, [showVnc])

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden bg-surface-sunken/40 flex flex-col",
        hasContainer ? "border-border-default" : "border-border-subtle",
        isStopped && "opacity-50",
      )}
    >
      {/* VNC viewport -- 16:10 aspect ratio */}
      <div className="relative w-full" style={{ aspectRatio: "16 / 10" }}>
        {showVnc ? (
          <VncScreen
            ref={vncRef}
            url={wsUrl}
            autoConnect={false}
            scaleViewport
            resizeSession
            background="#0a0a0a"
            style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
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
              {connState === "fetching-token" || connState === "connecting" ? (
                <div className="flex flex-col items-center gap-1">
                  <span className="h-3 w-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                  <span className="text-[7px] font-mono text-muted/40">connecting...</span>
                </div>
              ) : connState === "error" && errorMsg ? (
                <span className="text-[7px] font-mono text-danger/60">{errorMsg}</span>
              ) : isStopped ? (
                <span className="text-[7px] font-mono text-muted/20">session ended</span>
              ) : agent.lifecycleStatus === "error" ? (
                <span className="text-[6px] font-mono text-danger/50">Error: {agent.task}</span>
              ) : (
                <span className="text-[7px] font-mono text-muted/25">{agent.lifecycleStatus}</span>
              )}
            </div>
          </div>
        )}

        {/* Live indicator overlay */}
        {connState === "connected" && (
          <div className="absolute top-1 right-1 inline-flex items-center gap-1 rounded bg-black/50 px-1 py-px">
            <span className="h-1 w-1 rounded-full bg-success animate-breathe text-success" />
            <span className="text-[6px] text-success font-mono">live</span>
          </div>
        )}
      </div>
    </div>
  )
}
