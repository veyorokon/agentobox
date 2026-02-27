import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  Observable,
  split,
} from "@apollo/client"
import { GraphQLWsLink } from "@apollo/client/link/subscriptions"
import { getMainDefinition } from "@apollo/client/utilities"
import { createClient } from "graphql-ws"
import { createLogger } from "@/lib/logger"

/* ================================================================== */
/*  APOLLO CLIENT                                                      */
/*                                                                     */
/*  Mock mode (NEXT_PUBLIC_MOCK=1): cache-only, seed data.             */
/*  Real mode: HTTP + WS links, cache-and-network, subscriptions.      */
/* ================================================================== */

const log = createLogger("apollo")

export const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "1"
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/graphql"
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? API_URL.replace(/^http/, "ws")

/* ── Auth header helper ───────────────────────────────────────────── */

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("auth_token")
}

/* ── Logging link ────────────────────────────────────────────────── */

const loggingLink = new ApolloLink((operation, forward) => {
  const { operationName } = operation
  log("operation.start", { name: operationName, variables: operation.variables })

  if (!forward) return Observable.of()

  return forward(operation).map((result) => {
    if (result.errors?.length) {
      log("operation.error", { name: operationName, errors: result.errors }, "error")
    } else {
      log("operation.complete", { name: operationName, data: result.data })
    }
    return result
  })
})

/* ── Network links (real mode only) ──────────────────────────────── */

function buildNetworkLink(): ApolloLink {
  const httpLink = new HttpLink({
    uri: API_URL,
    headers: {
      get authorization() {
        const token = getAuthToken()
        return token ? `Bearer ${token}` : ""
      },
    },
  })

  const wsLink = new GraphQLWsLink(
    createClient({
      url: WS_URL,
      connectionParams: () => {
        const token = getAuthToken()
        return token ? { authorization: `Bearer ${token}` } : {}
      },
    }),
  )

  // Route subscriptions → WS, everything else → HTTP
  return split(
    ({ query }) => {
      const def = getMainDefinition(query)
      return def.kind === "OperationDefinition" && def.operation === "subscription"
    },
    wsLink,
    httpLink,
  )
}

/* ── Client ──────────────────────────────────────────────────────── */

const link = IS_MOCK
  ? loggingLink
  : ApolloLink.from([loggingLink, buildNetworkLink()])

export const client = new ApolloClient({
  link,
  cache: new InMemoryCache({
    typePolicies: {
      Agent: { keyFields: ["id"] },
      FeedItem: { keyFields: ["id"] },
      FeedQuestion: { keyFields: false },
      TodoProgress: { keyFields: false },
    },
  }),
})

// Seed mock data only in mock mode
if (IS_MOCK) {
  const { seedDevData } = require("@/lib/graphql/seed")
  seedDevData(client)
}
