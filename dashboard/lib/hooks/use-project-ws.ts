import { useEffect, useRef } from "react"
import { useApolloClient } from "@apollo/client"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { GET_AGENT_FEED, GET_FEED } from "@/lib/graphql/queries/feed"
import { createLogger } from "@/lib/logger"

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
  const { protocol, hostname } = window.location
  const wsProto = protocol === "https:" ? "wss:" : "ws:"
  return `${wsProto}//${hostname}:8000/ws/dashboard/${projectId}/`
}

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("auth_token")
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

      const token = getAuthToken()
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

      // Write full agents list to cache
      client.writeQuery({
        query: GET_AGENTS,
        variables: { projectId },
        data: { agents },
      })

      // Write full feed list to cache (query uses "feed" alias for teamFeed)
      client.writeQuery({
        query: GET_FEED,
        variables: { projectId },
        data: { feed },
      })
    }

    function handleAgentUpdate(agentData: Record<string, unknown>) {
      const agentId = agentData.id as string
      log("ws.agent_update", { agentId, name: agentData.name })

      // Read current agents from cache
      const existing = client.readQuery<{ agents: Record<string, unknown>[] }>({
        query: GET_AGENTS,
        variables: { projectId },
      })

      const currentAgents = existing?.agents ?? []
      const idx = currentAgents.findIndex((a) => a.id === agentId)

      let updatedAgents: Record<string, unknown>[]
      if (idx >= 0) {
        // Replace existing agent
        updatedAgents = [...currentAgents]
        updatedAgents[idx] = agentData
      } else {
        // Append new agent
        updatedAgents = [...currentAgents, agentData]
      }

      client.writeQuery({
        query: GET_AGENTS,
        variables: { projectId },
        data: { agents: updatedAgents },
      })

      // Trigger refetch of agent-specific timeline. Apollo only sends
      // the network request if there are active observers for this query
      // (i.e., the agent detail view is open for this agent).
      client.refetchQueries({ include: ["GetAgentFeed"] })
    }

    function handleFeedUpdate(feedData: Record<string, unknown>) {
      const feedId = feedData.id as string
      log("ws.feed_update", { feedId, type: feedData.type })

      // Read current feed from cache
      const existing = client.readQuery<{ feed: Record<string, unknown>[] }>({
        query: GET_FEED,
        variables: { projectId },
      })

      const currentFeed = existing?.feed ?? []
      const idx = currentFeed.findIndex((f) => f.id === feedId)

      let updatedFeed: Record<string, unknown>[]
      if (idx >= 0) {
        // Replace existing feed item (e.g. permission status change)
        updatedFeed = [...currentFeed]
        updatedFeed[idx] = feedData
      } else {
        // Prepend new feed item
        updatedFeed = [feedData, ...currentFeed]
      }

      client.writeQuery({
        query: GET_FEED,
        variables: { projectId },
        data: { feed: updatedFeed },
      })
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
