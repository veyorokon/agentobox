"use client"

import { useState, useMemo } from "react"
import {
  Search,
  ChevronRight,
  Check,
  CheckSquare,
  Plus,
  Trash2,
  BookOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useSkills, useCreateSkill, useDeleteSkill } from "@/lib/graphql/hooks/use-skills"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible } from "@/components/ui/collapsible"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { TagInput } from "@/components/shared/tag-input"
import { TagFilterDropdown } from "@/components/shared/tag-filter-dropdown"
import { useSelectMode } from "@/lib/hooks/use-select-mode"

export function SkillsPanel() {
  // Store state — shared across desktop and mobile skill views
  const search = useSidebarStore(s => s.skillSearch)
  const setSearch = useSidebarStore(s => s.setSkillSearch)
  const skillTagFilter = useSidebarStore(s => s.skillTagFilter)
  const setSkillTagFilter = useSidebarStore(s => s.setSkillTagFilter)
  const allExpanded = useSidebarStore(s => s.skillsAllExpanded)

  // Data hooks
  const { data: skillsData } = useSkills()
  const skills = skillsData?.skills ?? []
  const createSkill = useCreateSkill()
  const deleteSkill = useDeleteSkill()

  // Ephemeral state
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newContent, setNewContent] = useState("")
  const [newTags, setNewTags] = useState<string[]>([])
  const [newAssignAll, setNewAssignAll] = useState(false)
  const { selectMode, selectedIds: selectedSkills, setSelectMode, toggleSelect: toggleSkillSelect, toggleAll: toggleAllSkills, exitSelectMode: exitSkillSelectMode } = useSelectMode<typeof skills[number]>()

  const allSkillTags = useMemo(() => Array.from(new Set(skills.flatMap(s => s.assignedTags))).sort(), [skills])

  const handleCreateSkill = () => {
    if (!newName.trim()) return
    createSkill(newName.trim(), newContent, "", newTags, newAssignAll)
    setNewName("")
    setNewContent("")
    setNewTags([])
    setNewAssignAll(false)
    setShowCreate(false)
  }

  const handleBulkDelete = () => {
    selectedSkills.forEach(id => deleteSkill(id))
    exitSkillSelectMode()
  }

  const filtered = useMemo(() => {
    let result = skills
    if (search.trim()) {
      const q = search.toLowerCase().replace(/[-_]/g, " ")
      result = result.filter(s => {
        const name = s.name.toLowerCase().replace(/[-_]/g, " ")
        const desc = s.description.toLowerCase().replace(/[-_]/g, " ")
        return name.includes(q) || desc.includes(q)
      })
    }
    if (skillTagFilter) {
      result = result.filter(s => s.assignedTags.includes(skillTagFilter))
    }
    return result
  }, [skills, search, skillTagFilter])

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
        <TagFilterDropdown tags={allSkillTags} selected={skillTagFilter} onChange={setSkillTagFilter} />
        <button
          type="button"
          onClick={() => selectMode ? exitSkillSelectMode() : setSelectMode(true)}
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
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newAssignAll}
              onChange={(e) => setNewAssignAll(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-default bg-surface-sunken accent-accent"
            />
            <span className="text-[11px] text-secondary">Assign to all agents</span>
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={handleCreateSkill}
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
                        toggleSkillSelect(skill.id)
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
                      {skill.assignedToAll && (
                        <span className="text-[9px] font-mono text-accent/60 bg-accent/8 px-1.5 py-px rounded border border-accent/15 shrink-0">
                          all agents
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
            onClick={() => toggleAllSkills(filtered)}
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
            onClick={handleBulkDelete}
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
