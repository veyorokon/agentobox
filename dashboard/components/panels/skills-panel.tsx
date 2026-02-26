"use client"

import { useState, useMemo } from "react"
import {
  Search,
  Filter,
  ChevronRight,
  Check,
  CheckSquare,
  Plus,
  Trash2,
  BookOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible } from "@/components/ui/collapsible"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { TagInput } from "@/components/agent/tag-input"
import { SKILLS } from "@/lib/data/mock"

export function SkillsPanel() {
  // Store state — shared across desktop and mobile skill views
  const search = useSidebarStore(s => s.skillSearch)
  const setSearch = useSidebarStore(s => s.setSkillSearch)
  const skillTagFilter = useSidebarStore(s => s.skillTagFilter)
  const setSkillTagFilter = useSidebarStore(s => s.setSkillTagFilter)
  const allExpanded = useSidebarStore(s => s.skillsAllExpanded)

  // Ephemeral state
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newContent, setNewContent] = useState("")
  const [newTags, setNewTags] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [showSkillTagDropdown, setShowSkillTagDropdown] = useState(false)

  const allSkillTags = useMemo(() => Array.from(new Set(SKILLS.flatMap(s => s.assignedTags))).sort(), [])

  const filtered = useMemo(() => {
    let result = SKILLS
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      )
    }
    if (skillTagFilter) {
      result = result.filter(s => s.assignedTags.includes(skillTagFilter))
    }
    return result
  }, [search, skillTagFilter])

  return (
    <div className="flex flex-col h-full">
      {/* Search + create */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
        <div className="flex-1 flex items-center gap-1.5 min-w-0 rounded-md border border-border-default bg-surface-sunken/40 px-2 py-1">
          <Search className="h-3 w-3 text-muted/50 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="flex-1 bg-transparent border-none outline-none text-[11px] text-default placeholder:text-muted/30 min-w-0"
          />
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowSkillTagDropdown(!showSkillTagDropdown)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
              skillTagFilter
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border-default text-muted hover:text-secondary hover:bg-surface-raised/40",
            )}
          >
            <Filter className="h-3 w-3" />
            {skillTagFilter || "Tags"}
            <ChevronRight size={10} className="rotate-90 text-muted/40" />
          </button>
          {showSkillTagDropdown && (
            <div className="absolute top-full right-0 mt-1 w-32 rounded-md border border-border-default bg-surface-raised shadow-lg z-(--z-dropdown) overflow-hidden">
              <button
                type="button"
                onClick={() => { setSkillTagFilter(null); setShowSkillTagDropdown(false) }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-[11px] transition-colors",
                  !skillTagFilter ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                )}
              >
                All tags
              </button>
              {allSkillTags.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => { setSkillTagFilter(tag); setShowSkillTagDropdown(false) }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors",
                    skillTagFilter === tag ? "text-accent bg-accent/10" : "text-secondary hover:bg-surface-sunken/40",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (selectMode) {
              setSelectMode(false)
              setSelectedSkills(new Set())
            } else {
              setSelectMode(true)
            }
          }}
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
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0",
            showCreate
              ? "bg-accent/15 text-accent"
              : "text-muted hover:text-secondary hover:bg-surface-raised/50",
          )}
        >
          <Plus className="h-3 w-3" />
          Create
        </button>
      </div>

      {/* Create form */}
      <Collapsible open={showCreate}>
        <div className="px-3 py-2 border-b border-border-subtle space-y-2 bg-surface-sunken/20">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Skill name..."
            className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Markdown content..."
            rows={4}
            className="w-full bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors resize-none"
          />
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
              Assign to tags
            </label>
            <div className="bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 focus-within:border-accent/50 transition-colors">
              <TagInput tags={newTags} onChange={setNewTags} placeholder="Add tag..." />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!newName.trim()}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                newName.trim()
                  ? "bg-accent text-on-emphasis hover:bg-accent-hover"
                  : "bg-surface-sunken text-muted cursor-not-allowed",
              )}
            >
              Save
            </button>
          </div>
        </div>
      </Collapsible>

      {/* Skills list */}
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <BookOpen className="h-6 w-6 text-muted/20 mx-auto mb-1.5" />
              <p className="text-[11px] text-muted/50">No skills found</p>
            </div>
          ) : (
            filtered.map((skill) => {
              const isExpanded = !selectMode && (allExpanded || expandedSkills.has(skill.id))
              const isSelected = selectedSkills.has(skill.id)
              return (
                <div key={skill.id} className={cn(
                  "rounded-lg border overflow-hidden",
                  selectMode && isSelected ? "border-accent/40" : "border-border-subtle",
                )}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectMode) {
                        setSelectedSkills(prev => {
                          const next = new Set(prev)
                          if (next.has(skill.id)) next.delete(skill.id)
                          else next.add(skill.id)
                          return next
                        })
                      } else {
                        setExpandedSkills(prev => {
                          const next = new Set(prev)
                          if (next.has(skill.id)) next.delete(skill.id)
                          else next.add(skill.id)
                          return next
                        })
                      }
                    }}
                    className="w-full text-left px-2.5 py-2 hover:bg-surface-raised/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {selectMode ? (
                        <div
                          className={cn(
                            "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                            isSelected
                              ? "bg-accent/20 border-accent/50"
                              : "border-border-default",
                          )}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5 text-accent" strokeWidth={3} />}
                        </div>
                      ) : (
                        <ChevronRight
                          size={12}
                          className={cn(
                            "shrink-0 text-muted transition-transform duration-(--duration-normal)",
                            isExpanded && "rotate-90",
                          )}
                        />
                      )}
                      <span className="text-xs font-medium text-default flex-1 min-w-0 truncate">
                        {skill.name}
                      </span>
                      {skill.steps ? (
                        <span className="text-[9px] font-mono text-info/60 shrink-0">
                          {skill.steps} steps
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-muted/40 shrink-0">
                          skill
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 ml-5">
                      {skill.assignedTags.map((tag) => (
                        <span key={tag} className="px-1.5 py-px rounded text-[9px] font-mono text-accent/70 bg-accent/8 border border-accent/15">
                          {tag}
                        </span>
                      ))}
                      <span className="text-[9px] text-muted/40 font-mono">
                        {skill.description.length > 40 ? skill.description.slice(0, 40) + "..." : skill.description}
                      </span>
                    </div>
                  </button>
                  <Collapsible open={isExpanded}>
                    <div className="px-3 pb-3 border-t border-border-subtle bg-surface-sunken/10">
                      <MarkdownRenderer
                        content={skill.content}
                        className="text-xs text-secondary"
                      />
                    </div>
                  </Collapsible>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      {/* Bulk action bar for skills */}
      {selectMode && (
        <div className="px-3 py-1.5 border-t border-border-subtle bg-surface-sunken/30 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (selectedSkills.size === filtered.length) {
                setSelectedSkills(new Set())
              } else {
                setSelectedSkills(new Set(filtered.map(s => s.id)))
              }
            }}
            className="text-[11px] text-accent hover:text-accent-hover transition-colors shrink-0"
          >
            {selectedSkills.size === filtered.length ? "Deselect all" : "Select all"}
          </button>
          <span className="text-[11px] text-muted shrink-0">
            {selectedSkills.size} selected
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
              selectedSkills.size > 0
                ? "text-danger hover:bg-danger-subtle/40"
                : "text-muted cursor-not-allowed",
            )}
            disabled={selectedSkills.size === 0}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
