"use client"

import { useRef, useMemo, useCallback, createContext } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { FeedItemRouter } from "@/components/feed/feed-item"
import { StatusGroupRow } from "@/components/feed/status-group-row"
import { ThinkingIndicator } from "@/components/feed/thinking-indicator"
import { EmptyFeed } from "@/components/feed/empty-feed"
import type { TimelineEntry, ContentBlock } from "@/types"
import { isAssistantEntry, isUserEntry, isSystemEntry } from "@/types"
import { stripSystemReminders } from "@/lib/utils"

/** Allows children (e.g. ResultCard) to request scroll-to-bottom when they resize */
export const FeedScrollContext = createContext<{ scrollToBottom: () => void }>({
  scrollToBottom: () => {},
})

/* ------------------------------------------------------------------ */
/*  Pre-processing: consolidate raw events into renderable entries    */
/* ------------------------------------------------------------------ */

type DisplayEntryItem = { kind: "item"; item: TimelineEntry; showAvatar: boolean }
type DisplayEntryGroup = { kind: "status-group"; items: TimelineEntry[] }
type DisplayEntry = DisplayEntryItem | DisplayEntryGroup

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
  hasAgents?: boolean
  runningAgentNames?: string[]
}

export function FeedContainer({ items, loading, hasAgents = false, runningAgentNames = [] }: FeedContainerProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const displayEntries = useMemo(() => buildDisplayList(items), [items])

  const computeItemKey = useCallback(
    (_index: number, entry: DisplayEntry) => {
      if (entry.kind === "status-group") {
        return `sg-${entry.items.map((i) => i.id).join("-")}`
      }
      return entry.item.id
    },
    [],
  )

  const scrollCtx = useMemo(() => ({
    scrollToBottom: () => {
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        behavior: "smooth",
      })
    },
  }), [])

  // Stable components object — defining inline causes remounts on every render
  // which triggers "zero-sized element" warnings from Virtuoso
  const virtuosoComponents = useMemo(() => ({
    Footer: () => (
      <>
        {runningAgentNames.length > 0 && (
          <div className="flex items-center justify-center py-2">
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
      </>
    ),
  }), [loading, runningAgentNames])

  if (items.length === 0 && !loading) {
    return <EmptyFeed hasAgents={hasAgents} />
  }

  return (
    <FeedScrollContext.Provider value={scrollCtx}>
      <Virtuoso
        ref={virtuosoRef}
        data={displayEntries}
        computeItemKey={computeItemKey}
        initialTopMostItemIndex={displayEntries.length - 1}
        alignToBottom
        defaultItemHeight={80}
        followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
        skipAnimationFrameInResizeObserver
        increaseViewportBy={200}
        className="flex-1"
        itemContent={(_index, entry) =>
          <div style={{ minHeight: 1 }}>
            {entry.kind === "status-group" ? (
              <StatusGroupRow items={entry.items} />
            ) : (
              <FeedItemRouter item={entry.item} showAvatar={entry.showAvatar} />
            )}
          </div>
        }
        components={virtuosoComponents}
      />
    </FeedScrollContext.Provider>
  )
}
