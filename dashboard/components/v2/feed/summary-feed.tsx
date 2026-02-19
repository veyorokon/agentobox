'use client';

import { useMemo, useRef, useEffect, useCallback } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentsStore } from '@/stores/agents';
import { useFeedStore } from '@/stores/feed';
import { FeedItem } from './feed-item';
import type { MockFeedItem, MockAgent } from '@/lib/mock-v2-data';

// Speaker-change spacing: kinds that get extra gap around them
const DIVIDER_KINDS = new Set(['task-start', 'task-end']);

// Stable Virtuoso wrapper components — defined outside to avoid new refs each render
const VirtuosoItem = ({ children, ...props }: any) => (
  <div {...props} className="px-2">
    {children}
  </div>
);
const VirtuosoFooter = () => <div className="h-6" />;
const virtuosoComponents = { Item: VirtuosoItem, Footer: VirtuosoFooter };

export function SummaryFeed() {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const selectedAgentId = useDashboardStore((s) => s.selectedAgentId);
  const scrollToFeedId = useDashboardStore((s) => s.scrollToFeedId);

  const items = useFeedStore((s) => s.items);
  const agents = useAgentsStore((s) => s.sortedAgents);
  const colorMap = useAgentsStore((s) => s.agentColors);

  // Build lookup maps — but store in refs so renderItem callback stays stable
  const agentsMapRef = useRef<Record<string, MockAgent>>({});
  const colorMapRef = useRef<Record<string, string>>({});

  agentsMapRef.current = useMemo(() => {
    const m: Record<string, MockAgent> = {};
    for (const a of agents) m[a.id] = a;
    return m;
  }, [agents]);

  colorMapRef.current = colorMap;

  const filtered = useMemo(() => {
    if (!selectedAgentId) return items;
    return items.filter(
      (item) =>
        item.agentId === selectedAgentId ||
        (item.targetAgentIds?.includes(selectedAgentId) ?? false)
    );
  }, [items, selectedAgentId]);

  // Store filtered in a ref so the stable renderItem callback can peek at neighbours
  const filteredRef = useRef<MockFeedItem[]>(filtered);
  filteredRef.current = filtered;

  // Auto-scroll: Virtuoso's followOutput handles this natively.
  // Uses 'auto' (instant) instead of 'smooth' because with multiple agents
  // sending rapid messages, smooth animation can't finish before the next batch
  // arrives — causing Virtuoso to think you're not at bottom and disengage.
  const followOutput = useCallback((isAtBottom: boolean) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[feed] followOutput atBottom=${isAtBottom}`);
    }
    return isAtBottom ? 'auto' : false;
  }, []);

  useEffect(() => {
    if (!scrollToFeedId) return;
    const idx = filtered.findIndex((item) => item.id === scrollToFeedId);
    if (idx !== -1) {
      virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'smooth' });
    }
  }, [scrollToFeedId, filtered]);

  // Stable callback — reads agent data from refs, not from closure deps.
  // FeedItem is React.memo'd so existing items won't re-render even if this fires.
  const renderItem = useCallback(
    (index: number, item: MockFeedItem) => {
      const agent = agentsMapRef.current[item.agentId];
      const color = colorMapRef.current[item.agentId] ?? 'var(--muted-foreground)';

      // Compute top margin based on speaker change
      let mt = '';
      if (index > 0) {
        const prev = filteredRef.current[index - 1];
        if (prev) {
          const isDivider = DIVIDER_KINDS.has(item.kind) || DIVIDER_KINDS.has(prev.kind);
          if (isDivider) {
            mt = 'mt-5';
          } else {
            const sameSpeaker =
              item.kind === 'user-message' && prev.kind === 'user-message'
                ? true
                : item.kind !== 'user-message' && prev.kind !== 'user-message' && item.agentId === prev.agentId;
            mt = sameSpeaker ? '' : 'mt-3';
          }
        }
      }

      return (
        <div data-feed-id={item.id} className={mt}>
          <FeedItem
            item={item}
            agentColor={color}
            isLead={agent?.role === 'lead'}
            colorMap={colorMapRef.current}
          />
        </div>
      );
    },
    [] // No deps — reads from refs
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <Virtuoso
        ref={virtuosoRef}
        data={filtered}
        computeItemKey={(_, item) => item.id}
        followOutput={followOutput}
        atBottomThreshold={50}
        initialTopMostItemIndex={Math.max(0, filtered.length - 1)}
        itemContent={renderItem}
        className="scrollbar-thin"
        style={{ flex: 1 }}
        increaseViewportBy={{ top: 200, bottom: 200 }}
        components={virtuosoComponents}
      />
    </div>
  );
}
