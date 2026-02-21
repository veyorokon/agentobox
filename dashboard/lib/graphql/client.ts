import {
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  split,
} from "@apollo/client"
import { onError } from "@apollo/client/link/error"
import { GraphQLWsLink } from "@apollo/client/link/subscriptions"
import { getMainDefinition } from "@apollo/client/utilities"
import { createClient } from "graphql-ws"
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
    }
  }
  if (networkError) {
    console.error(`[Network error]: ${networkError}`)
  }
})

const httpLink = new HttpLink({
  uri: GRAPHQL_HTTP_URL,
})

const wsLink =
  typeof window !== "undefined"
    ? new GraphQLWsLink(
        createClient({
          url: GRAPHQL_WS_URL,
          connectionParams: () => {
            const token = getToken()
            return token ? { Authorization: `Bearer ${token}` } : {}
          },
        })
      )
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

const apolloClient = new ApolloClient({
  link: authLink.concat(errorLink).concat(splitLink),
  cache: new InMemoryCache({
    typePolicies: {
      AgentType: { keyFields: ["id"] },
      FeedItemType: { keyFields: ["id"] },
    },
  }),
})

export default apolloClient
