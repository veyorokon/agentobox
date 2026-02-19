import { create } from 'zustand';
import { adaptFeedItems, adaptFeedToTimeline } from '@/lib/feed-adapter';
import type { GqlFeedItem } from '@/lib/feed-adapter';
import type { MockFeedItem, TimelineTask, TimelineEvent } from '@/lib/mock-v2-data';

interface FeedState {
  items: MockFeedItem[];
  timeline: { tasks: TimelineTask[]; events: TimelineEvent[] };
  cursor: string | null;
  hasMore: boolean;
  fetching: boolean;
  loadingOlder: boolean;
  loadOlderFeed: (() => Promise<void>) | null;

  /** Initial load — replaces everything. */
  setItems: (raw: GqlFeedItem[], hasMore: boolean, cursor: string | null) => void;
  /** Subscription refresh — dedup-merge new items at the end. */
  mergeLatest: (raw: GqlFeedItem[]) => void;
  /** Scroll-up pagination — prepend older items. */
  prependOlder: (raw: GqlFeedItem[], hasMore: boolean, cursor: string | null) => void;
  setFetching: (v: boolean) => void;
  setLoadingOlder: (v: boolean) => void;
  setLoadOlderFeed: (fn: (() => Promise<void>) | null) => void;
  reset: () => void;
}

export const useFeedStore = create<FeedState>()((set) => ({
  items: [],
  timeline: { tasks: [], events: [] },
  cursor: null,
  hasMore: false,
  fetching: false,
  loadingOlder: false,
  loadOlderFeed: null,

  setItems: (raw, hasMore, cursor) => {
    const items = adaptFeedItems(raw);
    set({ items, timeline: adaptFeedToTimeline(items), hasMore, cursor });
  },

  mergeLatest: (raw) => {
    const incoming = adaptFeedItems(raw);
    set((state) => {
      const existingIds = new Set(state.items.map((i) => i.id));
      const fresh = incoming.filter((i) => !existingIds.has(i.id));
      if (fresh.length === 0) return state;
      const all = [...state.items, ...fresh];
      return { items: all, timeline: adaptFeedToTimeline(all) };
    });
  },

  prependOlder: (raw, hasMore, cursor) => {
    const older = adaptFeedItems(raw);
    set((state) => {
      const existingIds = new Set(state.items.map((i) => i.id));
      const fresh = older.filter((i) => !existingIds.has(i.id));
      if (fresh.length === 0) return { hasMore, cursor, loadingOlder: false };
      const all = [...fresh, ...state.items];
      return {
        items: all,
        timeline: adaptFeedToTimeline(all),
        hasMore,
        cursor,
        loadingOlder: false,
      };
    });
  },

  setFetching: (v) => set({ fetching: v }),
  setLoadingOlder: (v) => set({ loadingOlder: v }),
  setLoadOlderFeed: (fn) => set({ loadOlderFeed: fn }),
  reset: () => set({
    items: [], timeline: { tasks: [], events: [] },
    cursor: null, hasMore: false, fetching: false,
    loadingOlder: false, loadOlderFeed: null,
  }),
}));
