"use client"

import { useState, useCallback, useRef } from "react"
import { ArrowUp, Paperclip, X } from "lucide-react"
import type { RecipientEntry } from "@/lib/types"
import { useTeamStore } from "@/lib/stores/team"
import { useSendMessage } from "@/lib/graphql/hooks/use-feed"
import {
  RecipientSearchBox,
  recipientLabel,
  recipientKey,
  MAX_VISIBLE_PILLS,
} from "./recipient-search"

/* ================================================================== */
/*  COMPOSER BAR                                                       */
/* ================================================================== */

export function ComposerBar() {
  // ── Store subscriptions ───────────────────────────────────────────
  const recipients = useTeamStore(s => s.recipients)
  const addRecipient = useTeamStore(s => s.addRecipient)
  const removeRecipient = useTeamStore(s => s.removeRecipient)
  const [suggestions, setSuggestions] = useState<RecipientEntry[]>([])
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const sendMessage = useSendMessage()

  const handleSuggestionsChange = useCallback((s: RecipientEntry[]) => {
    setSuggestions(s)
  }, [])

  const canSend = text.trim().length > 0

  const handleSend = useCallback(() => {
    const msg = text.trim()
    if (!msg) return

    sendMessage(msg, recipients)
    setText("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [text, recipients, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const placeholderName = recipients.length === 0
    ? "your team"
    : recipients.length === 1
      ? recipients[0].type === "all" ? "all agents" : recipients[0].type === "agent" ? recipients[0].value : `#${recipients[0].value}`
      : `${recipients.length} recipients`
  const placeholder = `Message ${placeholderName}...`

  const visiblePills = recipients.slice(0, MAX_VISIBLE_PILLS)
  const overflowCount = Math.max(0, recipients.length - MAX_VISIBLE_PILLS)

  // Dont show committed pills when just the default @team-lead
  const isDefault = recipients.length === 1 && recipients[0].type === "agent" && recipients[0].value === "team-lead"

  return (
    <div className="px-6 pb-4 pt-2 max-w-3xl mx-auto w-full shrink-0">
      {/* Composer box */}
      <div className="relative rounded-2xl border-[0.5px] border-border-default bg-surface-raised/60 focus-within:bg-surface-raised focus-within:border-border-default">
        {/* Text input — auto-grows up to ~6 rows then scrolls */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = "auto"
            el.style.height = `${el.scrollHeight}px`
          }}
          className="w-full bg-transparent border-none outline-none resize-none px-4 pt-4 pb-2 text-sm text-default placeholder:text-muted min-h-[52px] max-h-[200px] overflow-y-auto"
        />

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-3 pb-3 gap-2">
          {/* Left side */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              disabled
              className="rounded-lg p-1.5 text-muted cursor-not-allowed opacity-50 shrink-0"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <RecipientSearchBox
              onSuggestionsChange={handleSuggestionsChange}
            />
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted font-mono tabular-nums">$0.30</span>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={`flex items-center justify-center h-8 w-8 rounded-full transition-colors ${
                canSend
                  ? "bg-accent text-white cursor-pointer hover:bg-accent/90"
                  : "bg-surface-sunken text-muted cursor-not-allowed"
              }`}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      {/* Pills row — underneath the composer box */}
      <div className="flex items-center gap-1.5 px-1 pt-2 min-w-0 overflow-x-auto no-scrollbar min-h-[28px]">
        {/* Committed pills */}
        {!isDefault && visiblePills.map((r, i) => (
          <span
            key={recipientKey(r)}
            className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full bg-surface-sunken text-[10px] font-mono text-secondary shrink-0"
          >
            {recipientLabel(r)}
            <button
              type="button"
              onClick={() => removeRecipient(i)}
              className="text-muted/40 hover:text-muted transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {!isDefault && overflowCount > 0 && (
          <span className="text-[10px] text-muted font-mono shrink-0">+{overflowCount}</span>
        )}
        {/* Autocomplete suggestions inline */}
        {suggestions.map(s => (
          <button
            key={`sug-${recipientKey(s)}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => addRecipient(s)}
            className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono bg-surface-sunken/50 text-muted hover:bg-surface-sunken hover:text-secondary transition-colors border border-border-subtle/50"
          >
            {recipientLabel(s)}
          </button>
        ))}
      </div>
    </div>
  )
}
