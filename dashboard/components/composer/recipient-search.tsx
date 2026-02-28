"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import type { RecipientEntry } from "@/lib/types"
import { useTeamStore } from "@/lib/stores/team"
import { useAgents } from "@/lib/graphql/hooks/use-agents"

/* ================================================================== */
/*  RECIPIENT SEARCH — dark search box for @agent / #tag               */
/* ================================================================== */

/** Max pills to show before collapsing to "+N" */
export const MAX_VISIBLE_PILLS = 6

export function recipientLabel(r: RecipientEntry): string {
  return r.type === "all" ? "@all" : r.type === "agent" ? `@${r.value}` : `#${r.value}`
}

export function recipientKey(r: RecipientEntry): string {
  return r.type === "all" ? "all" : `${r.type}-${r.value}`
}

export function RecipientSearchBox({
  onSuggestionsChange,
}: {
  onSuggestionsChange?: (suggestions: RecipientEntry[]) => void
}) {
  // ── Store subscriptions ───────────────────────────────────────────
  const { data } = useAgents()
  const agents = data?.agents ?? []
  const recipients = useTeamStore(s => s.recipients)
  const addRecipient = useTeamStore(s => s.addRecipient)
  const removeRecipient = useTeamStore(s => s.removeRecipient)
  const allTags = useMemo(() => Array.from(new Set(agents.flatMap(a => a.tags ?? []))).sort(), [agents])
  const [inputValue, setInputValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)

  // Ghost suggestion — includes @all as a special option
  const ghost = useMemo(() => {
    if (!inputValue) return null
    if (inputValue.startsWith("@")) {
      const partial = inputValue.slice(1).toLowerCase()
      if (!partial) return null
      if ("all".startsWith(partial) && "all" !== partial) return "all".slice(partial.length)
      if ("all" === partial) return null
      const match = agents.find(a => a.name.toLowerCase().startsWith(partial))
      if (match && match.name.toLowerCase() !== partial) return match.name.slice(partial.length)
      if (match && match.name.toLowerCase() === partial) return null
    }
    if (inputValue.startsWith("#")) {
      const partial = inputValue.slice(1).toLowerCase()
      if (!partial) return null
      const match = allTags.find(t => t.toLowerCase().startsWith(partial))
      if (match && match.toLowerCase() !== partial) return match.slice(partial.length)
      if (match && match.toLowerCase() === partial) return null
    }
    return null
  }, [inputValue, agents, allTags])

  const isCompleteMatch = useMemo(() => {
    if (inputValue.startsWith("@")) {
      const name = inputValue.slice(1).toLowerCase()
      if (name === "all") return true
      return agents.some(a => a.name.toLowerCase() === name)
    }
    if (inputValue.startsWith("#")) {
      const tag = inputValue.slice(1).toLowerCase()
      return allTags.some(t => t.toLowerCase() === tag)
    }
    return false
  }, [inputValue, agents, allTags])

  const commitInput = useCallback(() => {
    if (inputValue.startsWith("@")) {
      const name = inputValue.slice(1).toLowerCase()
      if (name === "all") { addRecipient({ type: "all" }); setInputValue(""); return true }
      const match = agents.find(a => a.name.toLowerCase() === name)
      if (match) { addRecipient({ type: "agent", value: match.name }); setInputValue(""); return true }
    }
    if (inputValue.startsWith("#")) {
      const tag = inputValue.slice(1).toLowerCase()
      const match = allTags.find(t => t.toLowerCase() === tag)
      if (match) { addRecipient({ type: "tag", value: match }); setInputValue(""); return true }
    }
    return false
  }, [inputValue, agents, allTags, addRecipient])

  const acceptGhost = useCallback(() => {
    if (!ghost) return false
    setInputValue(prev => prev + ghost)
    return true
  }, [ghost])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === "Tab" || e.key === "ArrowRight") && ghost) {
      e.preventDefault()
      acceptGhost()
      return
    }
    if ((e.key === "Enter" || e.key === " ") && isCompleteMatch) {
      e.preventDefault()
      commitInput()
      return
    }
    if (e.key === "Backspace" && inputValue === "" && recipients.length > 0) {
      e.preventDefault()
      removeRecipient(recipients.length - 1)
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setInputValue("")
    }
  }, [ghost, isCompleteMatch, inputValue, recipients.length, acceptGhost, commitInput, removeRecipient])

  // Autocomplete suggestions
  const suggestions = useMemo((): RecipientEntry[] => {
    if (!inputValue) return []
    if (inputValue.startsWith("@")) {
      const partial = inputValue.slice(1).toLowerCase()
      const results: RecipientEntry[] = []
      if (!partial || "all".startsWith(partial)) {
        if (!recipients.some(r => r.type === "all")) results.push({ type: "all" })
      }
      agents
        .filter(a => !partial || a.name.toLowerCase().startsWith(partial))
        .filter(a => !recipients.some(r => r.type === "agent" && r.value === a.name))
        .slice(0, 6)
        .forEach(a => results.push({ type: "agent", value: a.name }))
      return results
    }
    if (inputValue.startsWith("#")) {
      const partial = inputValue.slice(1).toLowerCase()
      return allTags
        .filter(t => !partial || t.toLowerCase().startsWith(partial))
        .filter(t => !recipients.some(r => r.type === "tag" && r.value === t))
        .slice(0, 6)
        .map(t => ({ type: "tag", value: t }))
    }
    return []
  }, [inputValue, agents, allTags, recipients])

  const suggestionsKey = suggestions.map(s => `${s.type}:${"value" in s ? s.value : ""}`).join(",")
  useEffect(() => {
    onSuggestionsChange?.(suggestions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionsKey, onSuggestionsChange])

  return (
    <div className="min-w-0">
      {/* Dark search input */}
      <div className="relative flex items-center min-w-0 rounded-md border border-border-subtle/50 bg-surface-sunken/30 px-2 py-0.5 w-36">
        <span
          ref={measureRef}
          className="invisible absolute whitespace-pre text-[11px] font-mono"
          aria-hidden
        >
          {inputValue}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="@agent or #tag"
          className="bg-transparent border-none outline-none text-[11px] font-mono text-default placeholder:text-muted/30 w-full min-w-0"
        />
        {ghost && (
          <span
            className="absolute pointer-events-none text-[11px] font-mono text-muted/25 whitespace-pre"
            style={{ left: `calc(0.5rem + ${measureRef.current?.offsetWidth ?? 0}px)` }}
          >
            {ghost}
          </span>
        )}
      </div>
    </div>
  )
}
