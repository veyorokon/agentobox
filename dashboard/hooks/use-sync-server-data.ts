'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
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
import { logger } from '@/lib/observability';
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

  // Only use the query for the INITIAL agent load. After that, all updates
  // come through the agentUpdated subscription. This prevents urql's document
  // cache invalidation (triggered by subscription AgentType results) from
  // refetching stale data that overwrites subscription-driven updates.
  const [agentsInitLoaded, setAgentsInitLoaded] = useState(false);

  useEffect(() => {
    useAgentsStore.getState().setFetching(agentsFetching);
  }, [agentsFetching]);

  useEffect(() => {
    if (agentsData?.agents && !agentsInitLoaded) {
      useAgentsStore.getState().setAgents(agentsData.agents as Agent[]);
      setAgentsInitLoaded(true);
    }
  }, [agentsData, agentsInitLoaded]);

  // ── Feed: initial load (all items) ──
  // Same pattern as agents: only use the query for the INITIAL load.
  // After that, all updates come through mergeLatest (subscription-driven).
  // Without this gate, urql's document cache invalidation (triggered by the
  // imperative fetchLatest) re-fires this useQuery, calling setItems which
  // replaces the entire array — causing Virtuoso to lose scroll position
  // and breaking followOutput auto-scroll.
  const [feedInitLoaded, setFeedInitLoaded] = useState(false);

  const [{ data: feedData, fetching: feedFetching }] = useQuery({
    query: PROJECT_FEED_QUERY,
    variables: { projectId },
    pause: !projectId,
  });

  useEffect(() => {
    useFeedStore.getState().setFetching(feedFetching);
  }, [feedFetching]);

  useEffect(() => {
    if (feedData?.projectFeed && !feedInitLoaded) {
      logger.debug('sync', 'feed initial load', { itemCount: feedData.projectFeed.length });
      useFeedStore.getState().setItems(feedData.projectFeed as GqlFeedItem[]);
      setFeedInitLoaded(true);
    } else if (feedData?.projectFeed && feedInitLoaded) {
      logger.debug('sync', 'feed useQuery re-fired (BLOCKED by gate)', { itemCount: feedData.projectFeed.length });
    }
  }, [feedData, feedInitLoaded]);

  // ── Imperative: fetch latest and merge (for subscriptions) ──
  const fetchLatest = useCallback(async () => {
    if (!projectId) return;
    logger.debug('sync', 'fetchLatest triggered (subscription -> network-only query)');
    const result = await client.query(
      PROJECT_FEED_QUERY,
      { projectId },
      { requestPolicy: 'network-only' },
    ).toPromise();
    if (result.data?.projectFeed) {
      logger.debug('sync', 'fetchLatest got items -> mergeLatest', { itemCount: result.data.projectFeed.length });
      useFeedStore.getState().mergeLatest(result.data.projectFeed as GqlFeedItem[]);
    }
  }, [client, projectId]);

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
    if (msgSubData) {
      logger.debug('sync', 'messageReceived subscription fired');
      debouncedFetchLatest();
    }
  }, [msgSubData, debouncedFetchLatest]);

  const [{ data: eventSubData }] = useSubscription(
    { query: NEW_EVENT_SUBSCRIPTION, variables: { projectId }, pause: !projectId },
    (_prev, data) => data
  );

  useEffect(() => {
    if (eventSubData) {
      logger.debug('sync', 'newEvent subscription fired');
      debouncedFetchLatest();
    }
  }, [eventSubData, debouncedFetchLatest]);

  // Reset stores on project change
  const prevProjectId = useRef(projectId);
  useEffect(() => {
    if (projectId !== prevProjectId.current) {
      useAgentsStore.getState().reset();
      useFeedStore.getState().reset();
      setAgentsInitLoaded(false);
      setFeedInitLoaded(false);
      prevProjectId.current = projectId;
    }
  }, [projectId]);
}
