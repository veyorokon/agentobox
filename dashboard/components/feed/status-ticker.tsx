"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { cn } from "@/lib/utils"
import { LIFECYCLE_CONFIG } from "@/lib/config"
import type { LifecycleStatus, TeamFeedItem } from "@/lib/types"
import { AgentTag } from "@/components/agent/avatar"

type StatusFeedItem = Extract<TeamFeedItem, { type: "status" }>

/** How long (ms) each transition stays visible before fading out. */
const LINGER_MS = 6000
/** Fade animation duration (ms). */
const FADE_MS = 400

type TickerEntry = {
  /** Unique key for React + dedup. */
  key: string
  item: StatusFeedItem
  /** Timestamp when this entry was added. */
  addedAt: number
  /** Whether this entry is fading out. */
  fading: boolean
}

/* ================================================================== */
/*  STATUS TICKER                                                       */
/*                                                                      */
/*  Ephemeral single-line status strip above the feed. Transitions     */
/*  fade in, linger, then dissolve. Overflow shows a "+N" counter.     */
/* ================================================================== */

export function StatusTicker({
  items,
  onClickAgent,
}: {
  items: StatusFeedItem[]
  onClickAgent?: (name: string) => void
}) {
  const [entries, setEntries] = useState<TickerEntry[]>([])
  const prevItemsRef = useRef<StatusFeedItem[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState<number | null>(null)

  // ── Detect new status items and add them as ticker entries ──────────
  useEffect(() => {
    const prevIds = new Set(prevItemsRef.current.map((i) => i.id))
    const newItems = items.filter((i) => !prevIds.has(i.id))
    prevItemsRef.current = items

    if (newItems.length === 0) return

    const now = Date.now()
    setEntries((prev) => {
      // Deduplicate: keep only the latest per agent
      const map = new Map<string, TickerEntry>()
      for (const e of prev) {
        if (!e.fading) map.set(e.item.agent, e)
      }
      for (const item of newItems) {
        map.set(item.agent, {
          key: `${item.agent}-${item.id}`,
          item,
          addedAt: now,
          fading: false,
        })
      }
      return Array.from(map.values())
    })
  }, [items])

  // ── Timer: mark entries as fading after LINGER_MS, remove after fade ──
  useEffect(() => {
    if (entries.length === 0) return

    const now = Date.now()
    let nextTick = Infinity

    for (const e of entries) {
      if (!e.fading) {
        const fadeAt = e.addedAt + LINGER_MS
        nextTick = Math.min(nextTick, fadeAt - now)
      } else {
        const removeAt = e.addedAt + LINGER_MS + FADE_MS
        nextTick = Math.min(nextTick, removeAt - now)
      }
    }

    if (!isFinite(nextTick)) return

    const timer = setTimeout(() => {
      const t = Date.now()
      setEntries((prev) =>
        prev
          // Remove fully expired entries
          .filter((e) => t < e.addedAt + LINGER_MS + FADE_MS)
          // Mark lingered entries as fading
          .map((e) =>
            !e.fading && t >= e.addedAt + LINGER_MS
              ? { ...e, fading: true }
              : e,
          ),
      )
    }, Math.max(nextTick, 16))

    return () => clearTimeout(timer)
  }, [entries])

  // ── Measure overflow: how many entries fit in one line ──────────────
  const entriesLengthRef = useRef(entries.length)
  entriesLengthRef.current = entries.length

  const measureOverflow = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const children = Array.from(container.children) as HTMLElement[]
    if (children.length === 0) {
      setVisibleCount(null)
      return
    }
    const containerTop = container.getBoundingClientRect().top
    let count = 0
    for (const child of children) {
      if (child.getBoundingClientRect().top > containerTop + 4) break
      count++
    }
    setVisibleCount(count < entriesLengthRef.current ? count : null)
  }, [])

  // Re-measure when entries change
  useEffect(() => {
    measureOverflow()
  }, [measureOverflow, entries])

  // Stable resize listener (registered once)
  useEffect(() => {
    window.addEventListener("resize", measureOverflow)
    return () => window.removeEventListener("resize", measureOverflow)
  }, [measureOverflow])

  // ── Visible entries (capped if overflowing) ────────────────────────
  const displayEntries = useMemo(() => {
    if (visibleCount === null) return entries
    // Show the most recent N entries that fit
    return entries.slice(-visibleCount)
  }, [entries, visibleCount])

  const overflowCount = visibleCount !== null ? entries.length - visibleCount : 0

  if (entries.length === 0) return null

  return (
    <div
      className="absolute top-0 left-0 right-0 z-10 pointer-events-none overflow-hidden"
      style={{ height: 28 }}
    >
      <div
        ref={containerRef}
        className="max-w-3xl mx-auto h-full flex items-center justify-center gap-x-4 px-3 @[640px]/main:px-6 overflow-hidden flex-nowrap pointer-events-auto"
      >
        {overflowCount > 0 && (
          <span className="text-[9px] text-muted/30 font-mono tabular-nums shrink-0">
            +{overflowCount}
          </span>
        )}
        {displayEntries.map((entry) => {
          const { item, fading, key } = entry
          const toConfig =
            LIFECYCLE_CONFIG[item.to as LifecycleStatus] ??
            LIFECYCLE_CONFIG.stopped

          return (
            <div
              key={key}
              className="flex items-center gap-1.5 shrink-0 transition-opacity"
              style={{
                opacity: fading ? 0 : 1,
                transitionDuration: `${FADE_MS}ms`,
                animation: fading ? undefined : `ticker-fade-in ${FADE_MS}ms ease-out`,
              }}
            >
              <AgentTag
                name={item.agent}
                onClick={onClickAgent}
                className="text-[10px]"
              />
              <span className="text-[9px] text-muted/30 font-mono">
                {item.from}
              </span>
              <span className="text-[9px] text-muted/20 select-none">→</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[9px] font-mono font-medium",
                  toConfig.text,
                )}
              >
                <span
                  className={cn(
                    "h-1 w-1 rounded-full shrink-0",
                    toConfig.dot,
                  )}
                />
                {item.to}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
