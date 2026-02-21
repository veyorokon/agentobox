"use client"

import { useRef, useEffect, useCallback } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { FeedItemRouter } from "@/components/feed/feed-item"
import type { FeedItem } from "@/types"

type FeedContainerProps = {
  items: FeedItem[]
  loading?: boolean
  onLoadMore?: () => void
}

export function FeedContainer({ items, loading, onLoadMore }: FeedContainerProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isScrollLockedRef = useRef(true)
  const prevLastIdRef = useRef<string | undefined>(undefined)
  const isLoadingMoreRef = useRef(false)

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

  // Auto-scroll to bottom when new items arrive and scroll is locked.
  // Compare on last item ID so agent switches also trigger scroll.
  useEffect(() => {
    const lastId = items[items.length - 1]?.id
    if (lastId !== prevLastIdRef.current && isScrollLockedRef.current && items.length > 0) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(items.length - 1, { align: "end" })
      })
    }
    prevLastIdRef.current = lastId
  }, [items, virtualizer])

  // IntersectionObserver on sentinel at top to trigger loadMore for older history
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !onLoadMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && !isLoadingMoreRef.current) {
          isLoadingMoreRef.current = true
          // Use Promise.resolve to handle both promise and non-promise returns
          Promise.resolve(onLoadMore()).finally(() => {
            isLoadingMoreRef.current = false
          })
        }
      },
      {
        root: parentRef.current,
        threshold: 0.1,
      }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoadMore])

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
      {/* Sentinel for loading older history when scrolled to top */}
      <div ref={sentinelRef} className="h-1 w-full" />

      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
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
