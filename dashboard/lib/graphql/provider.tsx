"use client"

import { ApolloProvider } from "@apollo/client/react"
import { client } from "@/lib/graphql/client"

/* ================================================================== */
/*  APOLLO PROVIDER WRAPPER                                            */
/*                                                                     */
/*  Client component that wraps children in ApolloProvider.            */
/*  Dev data is seeded at module scope in client.ts.                   */
/* ================================================================== */

export function GraphQLProvider({ children }: { children: React.ReactNode }) {
  return <ApolloProvider client={client}>{children}</ApolloProvider>
}
