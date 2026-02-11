/**
 * Timeline store — flat array of TimelineEntry sorted by createdAt.
 *
 * Single upsert pattern: subscription pushes TimelineEntry payloads,
 * store upserts by id. Replaces the per-agent message store for the feed.
 */
import { create } from 'zustand';
import type { TimelineEntry } from '@/types';

interface TimelineState {
  /** All timeline entries sorted by createdAt */
  entries: TimelineEntry[];
  /** Fast lookup by id for dedup */
  byId: Record<string, TimelineEntry>;
  /** Upsert a single entry (subscription event) */
  upsert: (entry: TimelineEntry) => void;
  /** Bulk hydrate from query (replaces all entries) */
  hydrate: (entries: TimelineEntry[]) => void;
}

function sortedInsert(
  entries: TimelineEntry[],
  byId: Record<string, TimelineEntry>,
  entry: TimelineEntry,
): { entries: TimelineEntry[]; byId: Record<string, TimelineEntry> } {
  const existing = byId[entry.id];
  const newById = { ...byId, [entry.id]: entry };

  if (existing) {
    // Update in place
    return {
      entries: entries.map((e) => (e.id === entry.id ? entry : e)),
      byId: newById,
    };
  }

  // Insert at correct position (most appends go to the end)
  const ts = new Date(entry.createdAt).getTime();
  if (entries.length === 0 || ts >= new Date(entries[entries.length - 1].createdAt).getTime()) {
    return { entries: [...entries, entry], byId: newById };
  }

  // Binary search for insert position (rare — out-of-order delivery)
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (new Date(entries[mid].createdAt).getTime() < ts) lo = mid + 1;
    else hi = mid;
  }
  const next = [...entries];
  next.splice(lo, 0, entry);
  return { entries: next, byId: newById };
}

export const useTimelineStore = create<TimelineState>((set) => ({
  entries: [],
  byId: {},

  upsert: (entry) =>
    set((state) => sortedInsert(state.entries, state.byId, entry)),

  hydrate: (entries) =>
    set(() => {
      const sorted = [...entries].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const byId: Record<string, TimelineEntry> = {};
      for (const e of sorted) {
        byId[e.id] = e;
      }
      return { entries: sorted, byId };
    }),
}));
