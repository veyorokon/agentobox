import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  Observable,
} from "@apollo/client"
import { onError } from "@apollo/client/link/error"
import { createLogger } from "@/lib/logger"

/* ================================================================== */
/*  APOLLO CLIENT                                                      */
/*                                                                     */
/*  HTTP link, cache-and-network. Real-time via useProjectWebSocket.    */
/* ================================================================== */

const log = createLogger("apollo")

/** Derive GraphQL HTTP URL from the current browser location.
 *  - NEXT_PUBLIC_API_URL override: always wins (build-time or runtime).
 *  - SSR: falls back to localhost:8000 (dev only).
 *  - Browser on standard port (80/443): same-origin /graphql (production behind reverse proxy).
 *  - Browser on non-standard port: same hostname, port 8000 (local dev).
 */
function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window === "undefined") return "http://localhost:8000/graphql"
  const { protocol, hostname, port } = window.location
  if (!port || port === "80" || port === "443") return `${protocol}//${hostname}/graphql`
  return `${protocol}//${hostname}:8000/graphql`
}

/* ── Auth header helper ───────────────────────────────────────────── */

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("auth_token")
}

/* ── Logging link ────────────────────────────────────────────────── */

/** Operations whose response data should never be logged (contains credentials). */
const REDACTED_OPS = new Set(["CreateVncToken", "Login"])

const loggingLink = new ApolloLink((operation, forward) => {
  const { operationName } = operation
  log("operation.start", { name: operationName, variables: operation.variables })

  if (!forward) return new Observable(subscriber => subscriber.complete())

  return new Observable(subscriber => {
    const sub = forward(operation).subscribe({
      next(result) {
        if (result.errors?.length) {
          log("operation.error", { name: operationName, errors: result.errors }, "error")
        } else {
          const data = REDACTED_OPS.has(operationName ?? "") ? "[redacted]" : result.data
          log("operation.complete", { name: operationName, data })
        }
        subscriber.next(result)
      },
      error(err) { subscriber.error(err) },
      complete() { subscriber.complete() },
    })
    return () => sub.unsubscribe()
  })
})

/* ── Auth error link — catch 401/403, redirect to login ─────────── */

const authErrorLink = onError(({ error }) => {
  if (typeof window === "undefined") return
  const status = error && "statusCode" in error ? (error as { statusCode: number }).statusCode : 0
  if (status === 401 || status === 403) {
    localStorage.removeItem("auth_token")
    if (window.location.pathname !== "/login") {
      window.location.href = "/login"
    }
  }
})

/* ── Network links ───────────────────────────────────────────────── */

const httpLink = new HttpLink({
  uri: getApiUrl,
  headers: {
    get authorization() {
      const token = getAuthToken()
      return token ? `Bearer ${token}` : ""
    },
  },
})

const networkLink = ApolloLink.from([authErrorLink, httpLink])

/* ── Client ──────────────────────────────────────────────────────── */

export const client = new ApolloClient({
  link: ApolloLink.from([loggingLink, networkLink]),
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          // agentFeed is fetched per-agent; cache separately by agentId
          // and allow full array replacement (suppresses merge warning)
          agentFeed: { keyArgs: ["agentId"], merge: (_existing: unknown, incoming: unknown) => incoming },
        },
      },
      AgentType: { keyFields: ["id"] },
      TeamFeedItemType: { keyFields: ["id"] },
      SkillType: { keyFields: ["id"] },
      FeedQuestionType: { keyFields: false },
      TaskProgressType: { keyFields: false },
      McpPackageType: { keyFields: false },
      McpRegistryServerType: { keyFields: ["name"] },
      TimelineEntryType: { keyFields: ["id"] },
    },
  }),
})
