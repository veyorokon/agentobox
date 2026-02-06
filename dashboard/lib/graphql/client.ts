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
  lazy: true,
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
      onOperation(operation) {
        const name = operation.query.definitions.find(
          (d): d is import('graphql').OperationDefinitionNode => d.kind === 'OperationDefinition'
        )?.name?.value ?? 'anonymous';
        const type = operation.kind;
        logger.debug('graphql', `${name} ${type}`, {operation: name, type, url: GRAPHQL_HTTP});
      },
      onResult(result) {
        const errors = result.data ? undefined : result.error?.graphQLErrors;
        if (errors?.length) {
          const name = result.operation.query.definitions.find(
            (d): d is import('graphql').OperationDefinitionNode => d.kind === 'OperationDefinition'
          )?.name?.value ?? 'anonymous';
          logger.warn('graphql.result', `${name} returned errors`, {
            operation: name,
            type: result.operation.kind,
            errors: errors.map((e) => e.message),
          });
        }
      },
      onError(error, operation) {
        const name = operation.query.definitions.find(
          (d): d is import('graphql').OperationDefinitionNode => d.kind === 'OperationDefinition'
        )?.name?.value ?? 'anonymous';
        const type = operation.kind;
        logger.error('graphql.error', `${name} ${type} failed`, {
          operation: name,
          type,
          url: GRAPHQL_HTTP,
          message: error.message,
          networkError: error.networkError?.message,
          graphQLErrors: error.graphQLErrors?.map((e) => e.message),
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
