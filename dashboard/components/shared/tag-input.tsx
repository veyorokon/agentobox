"use client"

import { useState, useRef, useCallback } from "react"
import { X } from "lucide-react"

export interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  /** Known tags in the project — shown as autocomplete suggestions. */
  suggestions?: string[]
}

export function TagInput({
  tags,
  onChange,
  placeholder = "Add tag...",
  suggestions = [],
}: TagInputProps) {
  const [input, setInput] = useState("")
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = useCallback((tag: string) => {
    const normalized = tag.toLowerCase().replace(/[^a-z0-9-]/g, "")
    if (normalized && !tags.includes(normalized)) {
      onChange([...tags, normalized])
    }
    setInput("")
    setShowDropdown(false)
    setHighlightIdx(-1)
  }, [tags, onChange])

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag))
  }

  // Case-insensitive prefix match, exclude already-added tags
  const filtered = input.trim()
    ? suggestions.filter(
        s => s.toLowerCase().startsWith(input.trim().toLowerCase()) && !tags.includes(s),
      ).slice(0, 7)
    : []

  const selectSuggestion = useCallback((suggestion: string) => {
    // Insert the canonical stored string, not the typed input
    if (!tags.includes(suggestion)) {
      onChange([...tags, suggestion])
    }
    setInput("")
    setShowDropdown(false)
    setHighlightIdx(-1)
    inputRef.current?.focus()
  }, [tags, onChange])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showDropdown && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightIdx(prev => Math.min(prev + 1, filtered.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightIdx(prev => Math.max(prev - 1, 0))
        return
      }
      if (e.key === "Enter" && highlightIdx >= 0) {
        e.preventDefault()
        selectSuggestion(filtered[highlightIdx])
        return
      }
    }

    if (e.key === "Escape") {
      setShowDropdown(false)
      setHighlightIdx(-1)
      return
    }

    if ((e.key === "Enter" || e.key === " ") && input.trim()) {
      e.preventDefault()
      addTag(input.trim())
    }
    if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
    setShowDropdown(true)
    setHighlightIdx(-1)
  }

  const handleBlur = () => {
    // onMouseDown on suggestions calls preventDefault, so blur only fires
    // when the user clicks away from both input and dropdown.
    if (input.trim()) addTag(input.trim())
    setShowDropdown(false)
    setHighlightIdx(-1)
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-mono text-accent"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="ml-0.5 text-accent/50 hover:text-accent transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={() => { if (input.trim()) setShowDropdown(true) }}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-[11px] font-mono text-default placeholder:text-muted/40"
        />
      </div>

      {/* Autocomplete dropdown */}
      {showDropdown && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border-default bg-surface-sunken/95 backdrop-blur-sm shadow-lg overflow-hidden max-h-[180px] overflow-y-auto">
          {filtered.map((suggestion, idx) => (
            <button
              key={suggestion}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault() // Prevent input blur
                selectSuggestion(suggestion)
              }}
              className={`w-full text-left px-2.5 py-1.5 text-[11px] font-mono transition-colors border-b border-border-subtle last:border-b-0 ${
                idx === highlightIdx
                  ? "bg-accent/10 text-accent"
                  : "text-secondary hover:bg-surface-raised/40"
              }`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
