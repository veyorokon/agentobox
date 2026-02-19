'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useSubscription, useClient } from 'urql';
import { useProjectsStore } from '@/stores/projects';
import { useAgentsStore } from '@/stores/agents';
import { useFeedStore } from '@/stores/feed';
import { AGENTS_QUERY, PROJECT_FEED_QUERY } from '@/lib/graphql/queries';
import {
  AGENT_UPDATED_SUBSCRIPTION,
  MESSAGE_RECEIVED_SUBSCRIPTION,
  NEW_EVENT_SUBSCRIPTION,
} from '@/lib/graphql/subscriptions';
import type { GqlFeedItem } from '@/lib/feed-adapter';
import type { Agent } from '@/types';

/**
 * Single hook that bridges urql (transport) to Zustand (state).
 * Call once at the root. This is the ONLY place useQuery/useSubscription
 * are called for agents and feed data.
 */
export function useSyncServerData() {
  const projectId = useProjectsStore((s) => s.currentProjectId);
  const client = useClient();

  // ── Agents: initial load ──
  const [{ data: agentsData, fetching: agentsFetching }] = useQuery({
    query: AGENTS_QUERY,
    variables: { projectId },
    pause: !projectId,
  });

  useEffect(() => {
    useAgentsStore.getState().setFetching(agentsFetching);
    if (agentsData?.agents) {
      useAgentsStore.getState().setAgents(agentsData.agents as Agent[]);
    }
  }, [agentsData, agentsFetching]);

  // ── Feed: initial load (newest page) ──
  const [{ data: feedData, fetching: feedFetching }] = useQuery({
    query: PROJECT_FEED_QUERY,
    variables: { projectId, limit: 50 },
    pause: !projectId,
  });

  useEffect(() => {
    useFeedStore.getState().setFetching(feedFetching);
    if (feedData?.projectFeed) {
      const conn = feedData.projectFeed as {
        items: GqlFeedItem[];
        hasMore: boolean;
        endCursor: string | null;
      };
      useFeedStore.getState().setItems(conn.items, conn.hasMore, conn.endCursor);
    }
  }, [feedData, feedFetching]);

  // ── Imperative: fetch latest page and merge (for subscriptions) ──
  const fetchLatest = useCallback(async () => {
    if (!projectId) return;
    const result = await client.query(
      PROJECT_FEED_QUERY,
      { projectId, limit: 50 },
      { requestPolicy: 'network-only' },
    ).toPromise();
    if (result.data?.projectFeed) {
      const conn = result.data.projectFeed as {
        items: GqlFeedItem[];
        hasMore: boolean;
        endCursor: string | null;
      };
      useFeedStore.getState().mergeLatest(conn.items);
    }
  }, [client, projectId]);

  // ── Imperative: load older page (for scroll-up pagination) ──
  const loadOlderFeed = useCallback(async () => {
    const { cursor, hasMore, loadingOlder } = useFeedStore.getState();
    if (!projectId || !hasMore || loadingOlder) return;
    useFeedStore.getState().setLoadingOlder(true);
    const result = await client.query(
      PROJECT_FEED_QUERY,
      { projectId, limit: 50, before: cursor },
      { requestPolicy: 'network-only' },
    ).toPromise();
    if (result.data?.projectFeed) {
      const conn = result.data.projectFeed as {
        items: GqlFeedItem[];
        hasMore: boolean;
        endCursor: string | null;
      };
      useFeedStore.getState().prependOlder(conn.items, conn.hasMore, conn.endCursor);
    } else {
      useFeedStore.getState().setLoadingOlder(false);
    }
  }, [client, projectId]);

  // Store loadOlderFeed in Zustand so SummaryFeed can call it
  useEffect(() => {
    useFeedStore.getState().setLoadOlderFeed(loadOlderFeed);
    return () => useFeedStore.getState().setLoadOlderFeed(null);
  }, [loadOlderFeed]);

  // ── Subscriptions ──
  // AgentUpdated -> granular store update (no refetch needed)
  const [{ data: agentSubData }] = useSubscription(
    { query: AGENT_UPDATED_SUBSCRIPTION, variables: { projectId }, pause: !projectId },
    (_prev, data) => data
  );

  useEffect(() => {
    if (agentSubData?.agentUpdated) {
      useAgentsStore.getState().updateAgent(agentSubData.agentUpdated as Agent);
    }
  }, [agentSubData]);

  // Feed events -> debounced merge of latest page
  const feedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetchLatest = useCallback(() => {
    if (feedTimer.current) clearTimeout(feedTimer.current);
    feedTimer.current = setTimeout(() => {
      fetchLatest();
    }, 500);
  }, [fetchLatest]);

  const [{ data: msgSubData }] = useSubscription(
    { query: MESSAGE_RECEIVED_SUBSCRIPTION, variables: { projectId }, pause: !projectId },
    (_prev, data) => data
  );

  useEffect(() => {
    if (msgSubData) debouncedFetchLatest();
  }, [msgSubData, debouncedFetchLatest]);

  const [{ data: eventSubData }] = useSubscription(
    { query: NEW_EVENT_SUBSCRIPTION, variables: { projectId }, pause: !projectId },
    (_prev, data) => data
  );

  useEffect(() => {
    if (eventSubData) debouncedFetchLatest();
  }, [eventSubData, debouncedFetchLatest]);

  // Reset stores on project change
  const prevProjectId = useRef(projectId);
  useEffect(() => {
    if (projectId !== prevProjectId.current) {
      useAgentsStore.getState().reset();
      useFeedStore.getState().reset();
      prevProjectId.current = projectId;
    }
  }, [projectId]);
}
