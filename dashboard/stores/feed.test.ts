import { describe, it, expect, beforeEach } from 'vitest';
import { useFeedStore } from './feed';
import type { GqlFeedItem } from '@/lib/feed-adapter';

/**
 * Helper to build a minimal GqlFeedItem for testing.
 * Only `id`, `kind`, `agentId`, `agentName`, and `timestamp` are required
 * by the adapter; everything else is nullable.
 */
function makeGqlItem(overrides: Partial<GqlFeedItem> & { id: string }): GqlFeedItem {
  return {
    kind: 'AGENT_TEXT',
    agentId: 'a1',
    agentName: 'lead',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('useFeedStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useFeedStore.getState().reset();
  });

  describe('setItems', () => {
    it('sets items from raw GqlFeedItem array', () => {
      const raw: GqlFeedItem[] = [
        makeGqlItem({ id: '1', text: 'Hello' }),
        makeGqlItem({ id: '2', text: 'World' }),
      ];

      useFeedStore.getState().setItems(raw);

      const { items } = useFeedStore.getState();
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('1');
      expect(items[1].id).toBe('2');
    });

    it('replaces existing items on subsequent calls', () => {
      useFeedStore.getState().setItems([
        makeGqlItem({ id: '1' }),
        makeGqlItem({ id: '2' }),
      ]);
      expect(useFeedStore.getState().items).toHaveLength(2);

      useFeedStore.getState().setItems([
        makeGqlItem({ id: '3' }),
      ]);
      const { items } = useFeedStore.getState();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('3');
    });

    it('populates timeline from adapted items', () => {
      useFeedStore.getState().setItems([
        makeGqlItem({ id: '1', kind: 'STATUS', fromStatus: 'deploying', toStatus: 'running' }),
      ]);

      const { timeline } = useFeedStore.getState();
      expect(timeline.events.length).toBeGreaterThanOrEqual(1);
      expect(timeline.events[0].kind).toBe('status');
    });
  });

  describe('mergeLatest', () => {
    it('appends new items that do not already exist', () => {
      useFeedStore.getState().setItems([
        makeGqlItem({ id: '1', text: 'first' }),
      ]);

      useFeedStore.getState().mergeLatest([
        makeGqlItem({ id: '2', text: 'second' }),
      ]);

      const { items } = useFeedStore.getState();
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('1');
      expect(items[1].id).toBe('2');
    });

    it('deduplicates items by id', () => {
      useFeedStore.getState().setItems([
        makeGqlItem({ id: '1', text: 'original' }),
      ]);

      useFeedStore.getState().mergeLatest([
        makeGqlItem({ id: '1', text: 'duplicate' }),
      ]);

      const { items } = useFeedStore.getState();
      expect(items).toHaveLength(1);
      // Original item is kept, duplicate is dropped
      expect(items[0].text).toBe('original');
    });

    it('only appends items with new ids in a mixed batch', () => {
      useFeedStore.getState().setItems([
        makeGqlItem({ id: '1' }),
        makeGqlItem({ id: '2' }),
      ]);

      useFeedStore.getState().mergeLatest([
        makeGqlItem({ id: '2' }), // duplicate
        makeGqlItem({ id: '3' }), // new
        makeGqlItem({ id: '4' }), // new
      ]);

      const { items } = useFeedStore.getState();
      expect(items).toHaveLength(4);
      expect(items.map((i) => i.id)).toEqual(['1', '2', '3', '4']);
    });

    it('returns same state reference when all items are duplicates', () => {
      useFeedStore.getState().setItems([
        makeGqlItem({ id: '1' }),
      ]);
      const stateBefore = useFeedStore.getState();

      useFeedStore.getState().mergeLatest([
        makeGqlItem({ id: '1' }),
      ]);
      const stateAfter = useFeedStore.getState();

      // When no new items, the set callback returns the existing state object
      expect(stateAfter.items).toBe(stateBefore.items);
    });
  });

  describe('setFetching', () => {
    it('sets fetching to true', () => {
      useFeedStore.getState().setFetching(true);
      expect(useFeedStore.getState().fetching).toBe(true);
    });

    it('sets fetching to false', () => {
      useFeedStore.getState().setFetching(true);
      useFeedStore.getState().setFetching(false);
      expect(useFeedStore.getState().fetching).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets items to empty array', () => {
      useFeedStore.getState().setItems([
        makeGqlItem({ id: '1' }),
        makeGqlItem({ id: '2' }),
      ]);
      expect(useFeedStore.getState().items).toHaveLength(2);

      useFeedStore.getState().reset();

      expect(useFeedStore.getState().items).toEqual([]);
    });

    it('resets timeline to empty tasks and events', () => {
      useFeedStore.getState().setItems([
        makeGqlItem({ id: '1', kind: 'STATUS', fromStatus: 'deploying', toStatus: 'running' }),
      ]);
      expect(useFeedStore.getState().timeline.events.length).toBeGreaterThan(0);

      useFeedStore.getState().reset();

      expect(useFeedStore.getState().timeline).toEqual({ tasks: [], events: [] });
    });

    it('resets fetching to false', () => {
      useFeedStore.getState().setFetching(true);
      useFeedStore.getState().reset();
      expect(useFeedStore.getState().fetching).toBe(false);
    });
  });
});
