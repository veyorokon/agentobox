"use client"

import { useState } from "react"
import { X } from "lucide-react"

export interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export function TagInput({
  tags,
  onChange,
  placeholder = "Add tag...",
}: TagInputProps) {
  const [input, setInput] = useState("")

  const addTag = (tag: string) => {
    const normalized = tag.toLowerCase().replace(/[^a-z0-9-]/g, "")
    if (normalized && !tags.includes(normalized)) {
      onChange([...tags, normalized])
    }
    setInput("")
  }

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag))
  }

  return (
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
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && input.trim()) {
            e.preventDefault()
            addTag(input.trim())
          }
          if (e.key === "Backspace" && !input && tags.length > 0) {
            removeTag(tags[tags.length - 1])
          }
        }}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-[11px] font-mono text-default placeholder:text-muted/40"
      />
    </div>
  )
}
