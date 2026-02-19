'use client';

import { useMemo } from 'react';
import { useQuery } from 'urql';
import { PROJECTS_QUERY, ME_QUERY } from '@/lib/graphql/queries';

/**
 * Low-frequency urql hooks that remain here (few consumers, no flicker risk).
 * High-frequency data (agents, feed) moved to Zustand stores.
 * @see stores/agents.ts, stores/feed.ts, hooks/use-sync-server-data.ts
 */

/** Projects list */
export function useProjects() {
  const [{ data }] = useQuery({ query: PROJECTS_QUERY });
  return useMemo(
    () => (data?.projects ?? []) as { id: string; name: string }[],
    [data]
  );
}

/** Current user */
export function useMe() {
  const [{ data }] = useQuery({ query: ME_QUERY });
  return data?.me ?? null;
}
