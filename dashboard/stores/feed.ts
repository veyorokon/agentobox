import { create } from 'zustand';
import { adaptFeedItems, adaptFeedToTimeline } from '@/lib/feed-adapter';
import type { GqlFeedItem } from '@/lib/feed-adapter';
import type { FeedItem, TaskItem, TimelineEvent } from '@/lib/mock-v2-data';

interface FeedState {
  items: FeedItem[];
  timeline: { tasks: TaskItem[]; events: TimelineEvent[] };
  fetching: boolean;

  /** Initial load — replaces everything. */
  setItems: (raw: GqlFeedItem[]) => void;
  /** Subscription refresh — dedup-merge new items at the end. */
  mergeLatest: (raw: GqlFeedItem[]) => void;
  setFetching: (v: boolean) => void;
  reset: () => void;
}

export const useFeedStore = create<FeedState>()((set) => ({
  items: [],
  timeline: { tasks: [], events: [] },
  fetching: false,

  setItems: (raw) => {
    const items = adaptFeedItems(raw);
    console.log(`[feed-store] setItems: ${raw.length} raw → ${items.length} adapted`);
    set({ items, timeline: adaptFeedToTimeline(items) });
  },

  mergeLatest: (raw) => {
    const incoming = adaptFeedItems(raw);
    set((state) => {
      const existingIds = new Set(state.items.map((i) => i.id));
      const fresh = incoming.filter((i) => !existingIds.has(i.id));
      console.log(`[feed-store] mergeLatest: ${incoming.length} incoming, ${fresh.length} fresh, ${state.items.length} existing`);
      if (fresh.length === 0) return state;
      const all = [...state.items, ...fresh];
      return { items: all, timeline: adaptFeedToTimeline(all) };
    });
  },

  setFetching: (v) => set({ fetching: v }),
  reset: () => set({
    items: [], timeline: { tasks: [], events: [] }, fetching: false,
  }),
}));
