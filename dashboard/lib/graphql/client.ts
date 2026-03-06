import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  Observable,
} from "@apollo/client"
import { createLogger } from "@/lib/logger"

/* ================================================================== */
/*  APOLLO CLIENT                                                      */
/*                                                                     */
/*  HTTP link, cache-and-network. Real-time via useProjectWebSocket.    */
/* ================================================================== */

const log = createLogger("apollo")

/** Derive GraphQL HTTP URL from the current browser hostname (same host, port 8000). */
function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window === "undefined") return "http://localhost:8000/graphql"
  const { protocol, hostname } = window.location
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

  if (!forward) return Observable.of()

  return forward(operation).map((result) => {
    if (result.errors?.length) {
      log("operation.error", { name: operationName, errors: result.errors }, "error")
    } else {
      const data = REDACTED_OPS.has(operationName) ? "[redacted]" : result.data
      log("operation.complete", { name: operationName, data })
    }
    return result
  })
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

const networkLink = httpLink

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
