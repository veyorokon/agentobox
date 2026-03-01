"use client"

import { Search, CheckSquare, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { TagFilterDropdown } from "@/components/shared/tag-filter-dropdown"

interface AgentFilterToolbarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  searchPlaceholder?: string
  tags: string[]
  selectedTag: string | null
  onTagChange: (tag: string | null) => void
  selectMode: boolean
  onSelectToggle: () => void
  onCreateClick?: () => void
  /** Extra elements rendered after the Create button (e.g. expand-all toggle) */
  trailing?: React.ReactNode
}

export function AgentFilterToolbar({
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search agents...",
  tags,
  selectedTag,
  onTagChange,
  selectMode,
  onSelectToggle,
  onCreateClick,
  trailing,
}: AgentFilterToolbarProps) {
  return (
    <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
      <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded-md border border-border-default bg-surface-sunken/40 px-2 py-1">
        <Search className="h-3 w-3 text-muted/50 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
        />
      </div>
      <TagFilterDropdown tags={tags} selected={selectedTag} onChange={onTagChange} />
      <button
        type="button"
        onClick={onSelectToggle}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors shrink-0",
          selectMode
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
        )}
      >
        <CheckSquare className="h-3 w-3" />
        {selectMode ? "Done" : "Select"}
      </button>
      {onCreateClick !== undefined && (
        <button
          type="button"
          onClick={onCreateClick}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 text-muted hover:text-secondary hover:bg-surface-raised/50"
        >
          <Plus className="h-3 w-3" />
          Create
        </button>
      )}
      {trailing}
    </div>
  )
}
