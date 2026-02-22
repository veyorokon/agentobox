"use client"

import { useRef, useEffect, useCallback, useMemo } from "react"
import { FeedItemRouter } from "@/components/feed/feed-item"
import { StatusGroupRow } from "@/components/feed/status-group-row"
import { ThinkingIndicator } from "@/components/feed/thinking-indicator"
import { EmptyFeed } from "@/components/feed/empty-feed"
import type { TimelineEntry, ContentBlock } from "@/types"
import { isAssistantEntry, isUserEntry, isSystemEntry } from "@/types"

/* ------------------------------------------------------------------ */
/*  Pre-processing: consolidate raw events into renderable entries    */
/* ------------------------------------------------------------------ */

type DisplayEntryItem = { kind: "item"; item: TimelineEntry; showAvatar: boolean }
type DisplayEntryGroup = { kind: "status-group"; items: TimelineEntry[] }
type DisplayEntry = DisplayEntryItem | DisplayEntryGroup

/** Extract message.id from an assistant event's data. */
function getMessageId(item: TimelineEntry): string {
  if (!isAssistantEntry(item)) return ""
  return item.data.message.id ?? ""
}

/** Check if an assistant entry has any visible content (text or tool_use). */
function hasVisibleContent(item: TimelineEntry): boolean {
  if (!isAssistantEntry(item)) return false
  const content = item.data.message.content
  if (!Array.isArray(content)) return false
  return content.some((b) => {
    return (b.type === "text" && "text" in b && b.text.trim().length > 0) || b.type === "tool_use"
  })
}

/** Check if a user event contains only tool_result blocks (no user text). */
function isToolResultOnly(item: TimelineEntry): boolean {
  if (!isUserEntry(item)) return false
  const content = item.data.message.content
  if (typeof content === "string") return false
  if (!Array.isArray(content)) return false
  return (content as ContentBlock[]).every((b) => b.type === "tool_result")
}

/** Strip <system-reminder>...</system-reminder> blocks injected by Claude Code into tool results. */
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim()
}

/**
 * Extract the text content from a tool_result block.
 * Content can be a string or array of content blocks.
 */
function extractToolResultText(block: Record<string, unknown>): string {
  const content = block.content
  if (typeof content === "string") return stripSystemReminders(content)
  if (Array.isArray(content)) {
    const raw = (content as Array<Record<string, unknown>>)
      .filter((b) => b.type === "text")
      .map((b) => (b.text as string) || "")
      .join("\n")
    return stripSystemReminders(raw)
  }
  return ""
}

/** Extract broadcast_id from a user event's content blocks (backend injects _broadcast metadata). */
function getBroadcastId(item: TimelineEntry): string | null {
  if (!isUserEntry(item)) return null
  const content = item.data.message.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    const b = block as unknown as Record<string, unknown>
    if (b.type === "_broadcast" && b.broadcast_id) {
      return b.broadcast_id as string
    }
  }
  return null
}

/**
 * Consolidate raw timeline items before display.
 *
 * Three phases:
 *   1. Collect content blocks per assistant message_id (merge incremental events)
 *   2. Collect tool results from user events (pair tool_result -> tool_use)
 *   3. Build result: merge assistants, enrich tool_use with results, filter noise
 *
 * Matches Anthropic's event model: each assistant event carries ONE content
 * block; multiple events share the same message.id. User events with
 * tool_result blocks are paired back to their originating tool_use.
 */
function consolidateItems(items: TimelineEntry[]): TimelineEntry[] {
  // Phase 1: collect all content blocks per assistant message_id
  const contentByMsgId = new Map<string, ContentBlock[]>()
  for (const item of items) {
    if (isAssistantEntry(item)) {
      const msgId = item.data.message.id
      if (msgId) {
        const content = item.data.message.content
        if (Array.isArray(content)) {
          if (!contentByMsgId.has(msgId)) contentByMsgId.set(msgId, [])
          contentByMsgId.get(msgId)!.push(...content)
        }
      }
    }
  }

  // Phase 2: collect tool results from user events
  const toolResults = new Map<string, { content: string; isError: boolean }>()
  for (const item of items) {
    if (!isUserEntry(item)) continue
    const content = item.data.message.content
    if (typeof content === "string" || !Array.isArray(content)) continue

    const toolUseResult = item.data.tool_use_result

    for (const block of content as ContentBlock[]) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue

      let text = extractToolResultText(block as unknown as Record<string, unknown>)

      // Prefer richer tool_use_result data when available
      if (toolUseResult) {
        const stdout = toolUseResult.stdout
        const file = toolUseResult.file
        if (stdout !== undefined) {
          text = stripSystemReminders(stdout)
        } else if (file?.content) {
          text = stripSystemReminders(file.content)
        }
      }

      toolResults.set(block.tool_use_id, {
        content: text,
        isError: !!block.is_error,
      })
    }
  }

  // Phase 3: build result — merge assistants, enrich tool_use, filter noise
  const seenMsgIds = new Set<string>()
  const seenBroadcastIds = new Set<string>()
  const result: TimelineEntry[] = []

  for (const item of items) {
    // Filter invisible entries
    if (item.entryType === "stream_event") continue
    if (item.entryType === "created") continue
    if (item.entryType === "status") continue // header dots already show this
    if (isSystemEntry(item)) {
      const sub = item.data.subtype
      if (sub === "relay_init" || sub === "init" || sub === "status" || sub === "process_exit") continue
    }

    if (isAssistantEntry(item)) {
      const msgId = item.data.message.id
      if (msgId) {
        if (seenMsgIds.has(msgId)) continue
        seenMsgIds.add(msgId)
        const mergedContent = contentByMsgId.get(msgId) ?? []
        // Skip if no visible content (thinking-only messages)
        const hasVisible = mergedContent.some((b) => {
          return (b.type === "text" && "text" in b && b.text.trim().length > 0) || b.type === "tool_use"
        })
        if (!hasVisible) continue
        // Enrich tool_use blocks with their matching results
        const enrichedContent = mergedContent.map((block) => {
          if (block.type === "tool_use" && block.id) {
            const tr = toolResults.get(block.id)
            if (tr) return { ...block, _result: tr }
          }
          return block
        })
        const origMsg = item.data.message
        result.push({
          ...item,
          data: {
            ...item.data,
            message: { ...origMsg, content: enrichedContent },
          },
        })
        continue
      }
      // No message_id — filter if no visible content
      if (!hasVisibleContent(item)) continue
    }

    // Filter user events that only contain tool_result blocks (consumed by enrichment)
    // Also deduplicate broadcast messages (same message sent to multiple agents)
    if (isUserEntry(item)) {
      if (isToolResultOnly(item)) continue
      const bid = getBroadcastId(item)
      if (bid) {
        if (seenBroadcastIds.has(bid)) continue
        seenBroadcastIds.add(bid)
      }
    }

    result.push(item)
  }

  if (process.env.NEXT_PUBLIC_GQL_DEBUG === "1") {
    const toolResultCount = toolResults.size
    const enrichedCount = result.filter((r) => {
      if (!isAssistantEntry(r)) return false
      const content = r.data.message.content
      if (!Array.isArray(content)) return false
      return content.some((b) => b.type === "tool_use" && b._result)
    }).length
    console.debug(
      `[Feed] consolidate: ${items.length} raw → ${result.length} display | ` +
      `${contentByMsgId.size} msg groups | ${toolResultCount} tool results | ${enrichedCount} enriched`
    )
  }

  return result
}

/* ------------------------------------------------------------------ */
/*  Display list: group status events, compute avatar visibility      */
/* ------------------------------------------------------------------ */

// TODO: isStatusLike + status grouping in buildDisplayList are dead code now that
// status/process_exit events are filtered in consolidateItems. Remove once confirmed.
/** Returns true for events that should be collapsed when consecutive */
function isStatusLike(item: TimelineEntry): boolean {
  if (item.entryType === "status") return true
  if (isSystemEntry(item)) {
    const subtype = item.data.subtype
    return subtype === "process_exit" || subtype === "status"
  }
  return false
}

/**
 * Walk through consolidated items, buffering consecutive status-like items.
 * Groups of >=3 collapse into a single DisplayEntryGroup.
 * Groups of <=2 stay as individual DisplayEntryItem entries.
 */
function buildDisplayList(items: TimelineEntry[]): DisplayEntry[] {
  const consolidated = consolidateItems(items)
  const result: DisplayEntry[] = []
  let statusBuffer: TimelineEntry[] = []
  let lastNonStatusItem: TimelineEntry | null = null

  function flushBuffer() {
    if (statusBuffer.length === 0) return
    if (statusBuffer.length >= 3) {
      result.push({ kind: "status-group", items: [...statusBuffer] })
    } else {
      for (const item of statusBuffer) {
        result.push({ kind: "item", item, showAvatar: false })
      }
    }
    statusBuffer = []
  }

  for (const item of consolidated) {
    if (isStatusLike(item)) {
      statusBuffer.push(item)
      continue
    }

    // Flush any buffered status items before this non-status item
    flushBuffer()

    // Compute showAvatar: show when agent changes or first assistant in a run
    const showAvatar =
      item.entryType !== "assistant" ||
      !lastNonStatusItem ||
      lastNonStatusItem.agentId !== item.agentId ||
      lastNonStatusItem.entryType !== "assistant"

    result.push({ kind: "item", item, showAvatar })
    lastNonStatusItem = item
  }

  // Flush remaining status items at end
  flushBuffer()

  return result
}

/* ------------------------------------------------------------------ */
/*  Feed container                                                    */
/* ------------------------------------------------------------------ */

type FeedContainerProps = {
  items: TimelineEntry[]
  loading?: boolean
  onLoadMore?: () => void
  hasAgents?: boolean
  runningAgentNames?: string[]
}

export function FeedContainer({ items, loading, onLoadMore, hasAgents = false, runningAgentNames = [] }: FeedContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const anchoredRef = useRef(true)
  const isLoadingMoreRef = useRef(false)

  const displayEntries = useMemo(() => buildDisplayList(items), [items])

  // Track whether user is at the bottom (anchored).
  // When anchored, new content auto-scrolls into view.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    anchoredRef.current = distanceFromBottom < 40
  }, [])

  // Scroll to bottom: on initial load and whenever content changes while anchored.
  // Uses a single RAF to let the browser lay out new content first.
  useEffect(() => {
    if (!anchoredRef.current || !bottomRef.current) return
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" })
    })
  }, [displayEntries])

  // IntersectionObserver on sentinel at top to trigger loadMore for older history
  useEffect(() => {
    const sentinel = topSentinelRef.current
    if (!sentinel || !onLoadMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && !isLoadingMoreRef.current) {
          isLoadingMoreRef.current = true
          Promise.resolve(onLoadMore()).finally(() => {
            isLoadingMoreRef.current = false
          })
        }
      },
      {
        root: scrollRef.current,
        threshold: 0.1,
      }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoadMore])

  if (items.length === 0 && !loading) {
    return <EmptyFeed hasAgents={hasAgents} />
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto"
      style={{ overflowAnchor: "none" }}
    >
      {/* Sentinel for loading older history when scrolled to top */}
      <div ref={topSentinelRef} className="h-1 w-full" />

      {displayEntries.map((entry, i) => (
        <div key={entry.kind === "status-group" ? `sg-${i}` : entry.item.id}>
          {entry.kind === "status-group" ? (
            <StatusGroupRow items={entry.items} />
          ) : (
            <FeedItemRouter item={entry.item} showAvatar={entry.showAvatar} />
          )}
        </div>
      ))}

      {runningAgentNames.length > 0 && (
        <div className="sticky bottom-0 flex items-center justify-center py-2 bg-gradient-to-t from-bg-000/90 to-transparent">
          <ThinkingIndicator
            label={runningAgentNames.length === 1
              ? `${runningAgentNames[0]} is working...`
              : `${runningAgentNames.length} agents working...`}
          />
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-3">
          <span className="text-text-400 text-xs">Loading...</span>
        </div>
      )}

      {/* Bottom anchor — scrollIntoView target */}
      <div ref={bottomRef} className="h-px" />
    </div>
  )
}
