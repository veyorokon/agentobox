"use client"

import { useState, useRef, useCallback } from "react"
import { Filter, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/use-click-outside"

interface TagFilterDropdownProps {
  tags: string[]
  selected: string | null
  onChange: (tag: string | null) => void
}

export function TagFilterDropdown({ tags, selected, onChange }: TagFilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useClickOutside(ref, close, open)

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
          selected
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
        )}
      >
        <Filter className="h-3 w-3" />
        {selected || "Tags"}
        <ChevronRight size={10} className="rotate-90 text-muted/40" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-32 rounded-md border border-border-default bg-surface-raised shadow-lg z-(--z-dropdown) overflow-hidden">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false) }}
            className={cn(
              "w-full text-left px-3 py-1.5 text-[11px] transition-colors",
              !selected ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
            )}
          >
            All tags
          </button>
          {tags.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => { onChange(tag); setOpen(false) }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors",
                selected === tag ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
