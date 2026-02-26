import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client"
import { seedMockData } from "@/lib/graphql/seed"
import { createLogger } from "@/lib/logger"

/* ================================================================== */
/*  APOLLO CLIENT                                                      */
/*                                                                     */
/*  Mock phase: cache-only, no network. Data seeded via writeQuery.    */
/*  Production: add HTTP + WS links, switch to cache-and-network.      */
/*                                                                     */
/*  Migration checklist:                                               */
/*  1. Add HttpLink pointing to backend /graphql                       */
/*  2. Add GraphQLWsLink for subscriptions                             */
/*  3. Add split() to route subscriptions to WS, rest to HTTP          */
/*  4. Add auth headers (Bearer token) to both links                   */
/*  5. Change fetchPolicy from 'cache-only' to 'cache-and-network'    */
/*  6. Remove seedMockData() call + import                             */
/* ================================================================== */

const log = createLogger("apollo")

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

/* ── Client ──────────────────────────────────────────────────────── */

export const client = new ApolloClient({
  link: loggingLink,
  cache: new InMemoryCache({
    typePolicies: {
      Agent: { keyFields: ["id"] },
      FeedItem: { keyFields: ["id"] },
      FeedQuestion: { keyFields: false },
      TodoProgress: { keyFields: false },
    },
  }),
})

// Seed at module scope — before any component renders.
// writeQuery during React render triggers Apollo cache broadcasts
// which cause useQuery hooks to re-render, creating infinite loops.
seedMockData(client)
