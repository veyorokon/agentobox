'use client';

import { useAgentsStore } from '@/stores/agents';
import { useFeedStore } from '@/stores/feed';

/** Sorted agents + fetching state. Drop-in replacement for old useAgents(). */
export function useAgents() {
  const sortedAgents = useAgentsStore((s) => s.sortedAgents);
  const fetching = useAgentsStore((s) => s.fetching);
  return { agents: sortedAgents, fetching };
}

/** Single agent's color. Primitive selector — only re-renders when this color changes. */
export function useAgentColor(agentId: string) {
  return useAgentsStore((s) => s.agentColors[agentId] ?? 'var(--muted-foreground)');
}

/** Agent stats for status bar. */
export function useAgentStats() {
  return useAgentsStore((s) => s.stats);
}

/** Agent color map (full record). */
export function useAgentColorMap() {
  return useAgentsStore((s) => s.agentColors);
}

/** Feed items + fetching state. Drop-in replacement for old useFeed(). */
export function useFeed() {
  const items = useFeedStore((s) => s.items);
  const fetching = useFeedStore((s) => s.fetching);
  return { items, fetching };
}

/** Timeline data (tasks + events). */
export function useTimeline() {
  return useFeedStore((s) => s.timeline);
}
