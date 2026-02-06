'use client';

import {
  Client,
  fetchExchange,
  subscriptionExchange,
  mapExchange,
} from 'urql';
import { createClient as createWSClient } from 'graphql-ws';
import { logger } from '@/lib/observability';

const GRAPHQL_HTTP =
  process.env.NEXT_PUBLIC_GRAPHQL_HTTP ?? 'http://localhost:8000/graphql';
const GRAPHQL_WS =
  process.env.NEXT_PUBLIC_GRAPHQL_WS ?? 'ws://localhost:8000/graphql';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth-token');
}

const wsClient = createWSClient({
  url: GRAPHQL_WS,
  connectionParams: () => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});

export const client = new Client({
  url: GRAPHQL_HTTP,
  fetchOptions: () => {
    const token = getToken();
    const headers: Record<string, string> = {
      ...logger.getTraceHeaders(),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return { headers };
  },
  exchanges: [
    mapExchange({
      onError(error) {
        logger.error('graphql', error.message, {
          graphQLErrors: error.graphQLErrors,
          networkError: error.networkError,
        });
      },
    }),
    fetchExchange,
    subscriptionExchange({
      forwardSubscription(request) {
        const input = { ...request, query: request.query || '' };
        return {
          subscribe(sink) {
            const unsubscribe = wsClient.subscribe(input, sink);
            return { unsubscribe };
          },
        };
      },
    }),
  ],
});
