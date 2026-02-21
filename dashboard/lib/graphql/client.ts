/**
 * Client-side only — do not import from server components.
 *
 * This module creates a singleton ApolloClient with an InMemoryCache and a
 * WebSocket link for subscriptions. Importing it in a server component would
 * share cache state across requests. All consumers must be "use client".
 */
import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  Observable,
  split,
} from "@apollo/client"
import { onError } from "@apollo/client/link/error"
import { GraphQLWsLink } from "@apollo/client/link/subscriptions"
import { getMainDefinition } from "@apollo/client/utilities"
import { Client, createClient } from "graphql-ws"
import { GRAPHQL_HTTP_URL, GRAPHQL_WS_URL } from "@/lib/constants"

function getToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem("auth-storage")
    if (!raw) return null
    return JSON.parse(raw)?.state?.token ?? null
  } catch {
    return null
  }
}

const AUTH_ERROR_PATTERNS = [
  "not authenticated",
  "permission denied",
  "unauthorized",
  "invalid token",
  "token expired",
]

function isAuthError(message: string): boolean {
  const lower = message.toLowerCase()
  return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p))
}

const authLink = new ApolloLink((operation, forward) => {
  const token = getToken()
  if (token) {
    operation.setContext({
      headers: { Authorization: `Bearer ${token}` },
    })
  }
  return forward(operation)
})

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    for (const err of graphQLErrors) {
      console.error(
        `[GraphQL error]: Message: ${err.message}, Location: ${JSON.stringify(err.locations)}, Path: ${err.path}`
      )

      // Check for auth errors and force logout
      const code = (err.extensions?.code as string) ?? ""
      if (
        code === "UNAUTHENTICATED" ||
        code === "FORBIDDEN" ||
        isAuthError(err.message)
      ) {
        // Dynamic import to avoid circular dependency
        import("@/stores/auth").then(({ useAuthStore }) => {
          useAuthStore.getState().logout()
        })
        break
      }
    }
  }
  if (networkError) {
    console.error(`[Network error]: ${networkError}`)
    // Check for 401 on network level
    if ("statusCode" in networkError && networkError.statusCode === 401) {
      import("@/stores/auth").then(({ useAuthStore }) => {
        useAuthStore.getState().logout()
      })
    }
  }
})


const loggingLink =
  process.env.NODE_ENV !== "production"
    ? new ApolloLink((operation, forward) => {
        const definition = getMainDefinition(operation.query)
        const opType =
          definition.kind === "OperationDefinition"
            ? definition.operation
            : "unknown"
        const opName = operation.operationName || "anonymous"

        if (opType === "subscription") {
          console.debug(`[GQL] ${opType} ${opName} started`)
          return new Observable((observer) => {
            const sub = forward(operation).subscribe({
              next: (result) => {
                console.debug(`[GQL] ${opType} ${opName} data received`)
                observer.next(result)
              },
              error: (err) => {
                console.debug(`[GQL] ${opType} ${opName} error`)
                observer.error(err)
              },
              complete: () => {
                console.debug(`[GQL] ${opType} ${opName} completed`)
                observer.complete()
              },
            })
            return () => {
              console.debug(`[GQL] ${opType} ${opName} unsubscribed`)
              sub.unsubscribe()
            }
          })
        }

        const start = performance.now()
        console.debug(`[GQL] ${opType} ${opName} started`)
        return forward(operation).map((result) => {
          const duration = Math.round(performance.now() - start)
          console.debug(`[GQL] ${opType} ${opName} completed in ${duration}ms`)
          return result
        })
      })
    : // In production, pass through without logging
      new ApolloLink((operation, forward) => forward(operation))

const httpLink = new HttpLink({
  uri: GRAPHQL_HTTP_URL,
})

// Export wsClient so it can be disposed on logout / token change
export let wsClient: Client | null = null

const wsLink =
  typeof window !== "undefined"
    ? (() => {
        wsClient = createClient({
          url: GRAPHQL_WS_URL,
          connectionParams: () => {
            const token = getToken()
            return token ? { Authorization: `Bearer ${token}` } : {}
          },
          retryAttempts: 20,
          shouldRetry: () => true,
          keepAlive: 10_000,
        })
        return new GraphQLWsLink(wsClient)
      })()
    : null

const splitLink = wsLink
  ? split(
      ({ query }) => {
        const definition = getMainDefinition(query)
        return (
          definition.kind === "OperationDefinition" &&
          definition.operation === "subscription"
        )
      },
      wsLink,
      httpLink
    )
  : httpLink

// Link chain: errorLink → loggingLink → authLink → splitLink
const apolloClient = new ApolloClient({
  link: ApolloLink.from([errorLink, loggingLink, authLink, splitLink]),
  cache: new InMemoryCache({
    typePolicies: {
      AgentType: { keyFields: ["id"] },
      FeedItemType: { keyFields: ["id"] },
      TimelineEntryType: { keyFields: ["id"] },
    },
  }),
})

/**
 * Reset Apollo client state: clear cache and dispose WebSocket connection.
 * Called from auth store on logout to prevent stale data and force
 * reconnection with fresh credentials.
 */
export async function resetApolloClient() {
  if (wsClient) {
    wsClient.dispose()
  }
  await apolloClient.clearStore()
}

export default apolloClient
