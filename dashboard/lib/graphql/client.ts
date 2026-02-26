import { ApolloClient, InMemoryCache } from "@apollo/client"
import { seedMockData } from "@/lib/graphql/seed"

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

export const client = new ApolloClient({
  cache: new InMemoryCache({
    typePolicies: {
      Agent: { keyFields: ["id"] },
      FeedItem: { keyFields: ["id"] },
      FeedQuestion: { keyFields: false },
      TodoProgress: { keyFields: false },
    },
  }),
  // No link — cache-only during mock phase
})

// Seed at module scope — before any component renders.
// writeQuery during React render triggers Apollo cache broadcasts
// which cause useQuery hooks to re-render, creating infinite loops.
seedMockData(client)
