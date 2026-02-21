"use client"

import { useRef, useEffect, useCallback } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/utils"
import { FeedItemRouter } from "@/components/feed/feed-item"
import type { FeedItem } from "@/types"

type FeedContainerProps = {
  items: FeedItem[]
  loading?: boolean
  onLoadMore?: () => void
}

export function FeedContainer({ items, loading, onLoadMore }: FeedContainerProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const isScrollLockedRef = useRef(true)
  const prevCountRef = useRef(items.length)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 10,
  })

  // Track whether user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isScrollLockedRef.current = distanceFromBottom < 60
  }, [])

  // Auto-scroll to bottom when new items arrive and scroll is locked
  useEffect(() => {
    if (items.length > prevCountRef.current && isScrollLockedRef.current) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(items.length - 1, { align: "end" })
      })
    }
    prevCountRef.current = items.length
  }, [items.length, virtualizer])

  if (items.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-text-400 text-sm">No messages yet</span>
      </div>
    )
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto"
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full px-4 py-1"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <FeedItemRouter item={items[virtualRow.index]} />
          </div>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-3">
          <span className="text-text-400 text-xs">Loading...</span>
        </div>
      )}
    </div>
  )
}
