"use client"

import { useRef, useEffect, useMemo } from "react"
import type { Agent, TimelineEntry } from "@/lib/types"
import {
  formatDuration,
  friendlyToolName,
  friendlyModelName,
  computeLineDelta,
  shortenFilePath,
} from "@/lib/utils"
import { useAgentFeed } from "@/lib/graphql/hooks/use-feed"
import { AssistantMessage } from "@/components/feed/assistant-message"
import { SingleToolRow, MultiToolGroup, type ToolEntryData } from "@/components/feed/tool-row"
import { ResultPill } from "@/components/feed/result-pill"
import { SystemMessage } from "@/components/feed/system-message"
import { TeamUserMessage } from "@/components/feed/user-message"
import { AgentToAgentMessage } from "@/components/feed/agent-message"
import { ErrorBubble } from "@/components/feed/error-bubble"

/* ================================================================== */
/*  AGENT DETAIL FEED                                                  */
/* ================================================================== */

export interface AgentDetailFeedProps {
  agent: Agent
}

/* ── Data mapping helpers ─────────────────────────────────────────── */

type ContentBlock = Record<string, unknown>

/** Extract summary, filePath, lineDelta, and diff strings from a tool_use block. */
function extractToolSummary(toolUse: ContentBlock): {
  summary: string
  filePath?: string
  lineDelta?: { added: number; removed: number } | null
  oldString?: string
  newString?: string
} {
  const input = (toolUse.input ?? {}) as Record<string, unknown>
  const name = String(toolUse.name ?? "")

  // File path extraction
  const filePath = input.file_path ? shortenFilePath(String(input.file_path)) : undefined

  // Line delta for Edit/Write
  const lineDelta = (name === "Edit" || name === "Write") ? computeLineDelta(input) : null

  // Summary: same priority chain but skip file_path (shown as pill)
  let summary = ""
  if (input.command) summary = String(input.command).slice(0, 100)
  else if (input.pattern) summary = String(input.pattern)
  else if (input.query) summary = String(input.query).slice(0, 100)
  else if (input.url) summary = String(input.url)
  else if (input.questions && Array.isArray(input.questions)) {
    const q = input.questions[0] as Record<string, unknown> | undefined
    if (q?.question) summary = String(q.question).slice(0, 100)
    else if (q?.header) summary = String(q.header)
  } else if (input.plan) {
    const firstLine = String(input.plan).split("\n").find(l => l.trim())?.replace(/^#+\s*/, "")
    if (firstLine) summary = firstLine.slice(0, 100)
  } else if (input.subject) summary = String(input.subject).slice(0, 100)
  else if (input.prompt) summary = String(input.prompt).slice(0, 100)
  else if (input.description) summary = String(input.description).slice(0, 100)
  else if (filePath) summary = "" // file path shown as pill, no redundant summary
  else {
    const json = JSON.stringify(input)
    summary = json.length > 80 ? json.slice(0, 77) + "..." : json
  }

  // Extract old/new strings for diff view (Edit tool)
  const oldString = typeof input.old_string === "string" ? input.old_string : undefined
  const newString = typeof input.new_string === "string" ? input.new_string : undefined

  return { summary, filePath, lineDelta, oldString, newString }
}

/** Build a map from tool_use_id → result content string by scanning user entries. */
function buildToolResultMap(entries: TimelineEntry[]): Map<string, { content: string; isError: boolean }> {
  const map = new Map<string, { content: string; isError: boolean }>()

  for (const entry of entries) {
    if (entry.entryType !== "user") continue

    const data = entry.data as Record<string, unknown>
    const message = data?.message as Record<string, unknown> | undefined
    const content = (message?.content ?? []) as ContentBlock[]

    for (const block of content) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue

      const toolUseId = String(block.tool_use_id)
      const isError = Boolean(block.is_error)
      const raw = block.content

      // content can be a string or an array of content blocks
      let text: string
      if (typeof raw === "string") {
        text = raw
      } else if (Array.isArray(raw)) {
        text = raw
          .filter((b: unknown) => typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text")
          .map((b: unknown) => String((b as Record<string, unknown>).text ?? ""))
          .join("\n")
      } else {
        text = ""
      }

      map.set(toolUseId, { content: text, isError })
    }
  }

  return map
}

/** Render a single TimelineEntry based on its entryType and raw data. */
function TimelineEntryRow({
  entry,
  agentName,
  toolResultMap,
}: {
  entry: TimelineEntry
  agentName: string
  toolResultMap: Map<string, { content: string; isError: boolean }>
}) {
  const data = entry.data as Record<string, unknown>

  switch (entry.entryType) {
    case "assistant": {
      const message = data?.message as Record<string, unknown> | undefined
      const content = (message?.content ?? []) as ContentBlock[]
      const textBlocks = content.filter(b => b.type === "text")
      const toolUses = content.filter(b => b.type === "tool_use")
      const text = textBlocks.map(b => String(b.text ?? "")).join("\n\n").trim()

      return (
        <>
          {text && <AssistantMessage agent={agentName} content={text} showAvatar={false} />}
          {toolUses.length === 1 && (() => {
            const tu = toolUses[0]
            const tuId = String(tu.id ?? "")
            const result = toolResultMap.get(tuId)
            const { summary, filePath, lineDelta, oldString, newString } = extractToolSummary(tu)
            return (
              <SingleToolRow
                tool={{
                  name: friendlyToolName(String(tu.name ?? "tool")),
                  summary,
                  filePath,
                  lineDelta,
                  result: result?.content,
                  isError: result?.isError,
                  oldString,
                  newString,
                }}
              />
            )
          })()}
          {toolUses.length > 1 && (
            <MultiToolGroup
              tools={toolUses.map(t => {
                const tuId = String(t.id ?? "")
                const result = toolResultMap.get(tuId)
                const { summary, filePath, lineDelta, oldString, newString } = extractToolSummary(t)
                return {
                  name: friendlyToolName(String(t.name ?? "tool")),
                  summary,
                  filePath,
                  lineDelta,
                  result: result?.content,
                  isError: result?.isError,
                  oldString,
                  newString,
                } satisfies ToolEntryData
              })}
            />
          )}
        </>
      )
    }

    case "result": {
      const cost = Number(data?.total_cost_usd ?? 0)
      const durationMs = Number(data?.duration_ms ?? 0)
      const turns = Number(data?.num_turns ?? 0)
      const isError = Boolean(data?.is_error)
      const modelUsage = (data?.modelUsage ?? undefined) as Record<string, Record<string, number>> | undefined

      if (isError) {
        const errorText = String(data?.error ?? "Agent encountered an error")
        return <ErrorBubble agent={agentName} text={errorText} showAgent={false} />
      }

      return (
        <ResultPill
          cost={cost}
          duration={formatDuration(durationMs)}
          turns={turns}
          model={friendlyModelName(String(data?.model ?? ""))}
          modelUsage={modelUsage}
          isError={false}
        />
      )
    }

    case "system": {
      const subtype = String(data?.subtype ?? "system")
      if (subtype === "init") return <SystemMessage text="Session initialized" />
      if (subtype === "process_exit") {
        const code = data?.exit_code
        return <SystemMessage text={`Process exited (code ${code ?? "?"})`} />
      }
      // "status" subtype is redundant with the dedicated "status" entryType
      if (subtype === "status") return null
      return <SystemMessage text={subtype} />
    }

    case "user": {
      const message = data?.message as Record<string, unknown> | undefined
      const content = (message?.content ?? []) as ContentBlock[]
      const teamFrom = data?.team_message_from as string | undefined
      let text = content
        .filter(b => b.type === "text")
        .map(b => String(b.text ?? ""))
        .join("\n")
        .trim()
      // Skip tool_result-only messages (those are tool outputs, not user input)
      if (!text) return null
      // Team messages have team_message_from metadata set by interagent.py
      if (teamFrom) {
        const body = text.replace(/^\[Team message from .+?\]:\s*/, "")
        return <AgentToAgentMessage from={teamFrom} to={agentName} text={body} />
      }
      return <TeamUserMessage text={text} />
    }

    case "status": {
      const from = String(data?.from ?? "")
      const to = String(data?.to ?? "")
      return <SystemMessage text={`${from} → ${to}`} />
    }

    default:
      return null
  }
}

/* ── Main component ───────────────────────────────────────────────── */

export function AgentDetailFeed({ agent }: AgentDetailFeedProps) {
  const { data, loading } = useAgentFeed(agent.id)
  const entries = data?.agentFeed ?? []
  const scrollRef = useRef<HTMLDivElement>(null)

  // Build tool_use_id → result map once per entry set
  const toolResultMap = useMemo(() => buildToolResultMap(entries), [entries])

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Only auto-scroll if already near the bottom (within 80px)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [entries.length])

  const isEmpty = !loading && entries.length === 0

  return (
    <div className="h-full flex flex-col">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2"
      >
        {loading && entries.length === 0 && (
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-muted/50 font-mono animate-pulse">Loading...</span>
          </div>
        )}
        {isEmpty && (
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-muted/50 font-mono">
              {agent.lifecycleStatus === "deploying" ? "Initializing workspace..." : "No activity yet"}
            </span>
          </div>
        )}
        {entries.map(entry => (
          <TimelineEntryRow
            key={entry.id}
            entry={entry}
            agentName={agent.name}
            toolResultMap={toolResultMap}
          />
        ))}
      </div>
    </div>
  )
}
