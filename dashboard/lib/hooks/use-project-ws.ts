import { useEffect, useRef } from "react"
import { useApolloClient } from "@apollo/client/react"
import { applySnapshot, upsertAgent, upsertFeedItem } from "@/lib/graphql/cache-ops"
import { createLogger } from "@/lib/logger"
import { getToken, clearTokenAndRedirect } from "@/lib/auth"

/* ================================================================== */
/*  PROJECT WEBSOCKET HOOK                                              */
/*                                                                      */
/*  Replaces polling with server-push. Opens a single WS per project,  */
/*  authenticates, receives snapshot + incremental updates, and writes  */
/*  directly to Apollo cache. All existing components that read from   */
/*  Apollo cache update automatically — no component changes needed.   */
/*                                                                      */
/*  Message types from server:                                         */
/*    _t: "snapshot" — full state: { agents: [...], feed: [...] }      */
/*    _t: "agent"    — single agent upsert (includes __typename)       */
/*    _t: "feed"     — single feed item upsert (includes __typename)   */
/* ================================================================== */

const log = createLogger("ws")

const RECONNECT_BASE_MS = 1_000
const RECONNECT_CAP_MS = 30_000

function getWsUrl(projectId: string): string {
  if (typeof window === "undefined") return ""
  const { protocol, hostname, port } = window.location
  const wsProto = protocol === "https:" ? "wss:" : "ws:"
  const host = !port || port === "80" || port === "443"
    ? hostname
    : `${hostname}:8000`
  return `${wsProto}//${host}/ws/dashboard/${projectId}/`
}

/**
 * Project-scoped WebSocket that streams real-time updates into Apollo cache.
 * Call once at project layout level where projectId is available.
 */
export function useProjectWebSocket(projectId: string | undefined) {
  const client = useApolloClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempt = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmounted = useRef(false)

  useEffect(() => {
    unmounted.current = false

    if (!projectId) return

    function connect() {
      if (unmounted.current) return

      const token = getToken()
      if (!token) {
        log("ws.no_token", { projectId })
        return
      }

      const url = getWsUrl(projectId!)
      log("ws.connecting", { projectId, attempt: reconnectAttempt.current })

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        log("ws.open", { projectId })
        reconnectAttempt.current = 0
        // Authenticate immediately
        ws.send(JSON.stringify({ type: "auth", token }))
      }

      ws.onmessage = (event) => {
        let data: Record<string, unknown>
        try {
          data = JSON.parse(event.data)
        } catch {
          log("ws.parse_error", { raw: event.data }, "error")
          return
        }

        const msgType = data._t as string

        if (msgType === "snapshot") {
          handleSnapshot(data)
        } else if (msgType === "agent") {
          const { _t, ...agentData } = data
          handleAgentUpdate(agentData)
        } else if (msgType === "feed") {
          const { _t, ...feedData } = data
          handleFeedUpdate(feedData)
        } else {
          log("ws.unknown_type", { _t: msgType })
        }
      }

      ws.onclose = (event) => {
        log("ws.closed", { projectId, code: event.code })
        wsRef.current = null

        // 4001 = auth rejected (bad/expired token). Clear stale token
        // and redirect to login instead of retrying forever.
        if (event.code === 4001) {
          clearTokenAndRedirect("ws_4001")
          return
        }

        scheduleReconnect()
      }

      ws.onerror = () => {
        log("ws.error", { projectId }, "error")
        // onclose will fire after onerror — reconnect handled there
      }
    }

    function handleSnapshot(data: Record<string, unknown>) {
      const agents = data.agents as Record<string, unknown>[]
      const feed = data.feed as Record<string, unknown>[]
      log("ws.snapshot", { agents: agents?.length ?? 0, feed: feed?.length ?? 0 })
      applySnapshot(client, projectId!, agents, feed)
    }

    function handleAgentUpdate(agentData: Record<string, unknown>) {
      log("ws.agent_update", { id: agentData.id, name: agentData.name })
      upsertAgent(client, projectId!, agentData)
    }

    function handleFeedUpdate(feedData: Record<string, unknown>) {
      log("ws.feed_update", { id: feedData.id, type: feedData.type })
      upsertFeedItem(client, projectId!, feedData)
    }

    function scheduleReconnect() {
      if (unmounted.current) return

      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt.current),
        RECONNECT_CAP_MS,
      )
      reconnectAttempt.current += 1
      log("ws.reconnect_scheduled", { delay, attempt: reconnectAttempt.current })

      reconnectTimer.current = setTimeout(connect, delay)
    }

    connect()

    return () => {
      unmounted.current = true
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [projectId, client])
}
