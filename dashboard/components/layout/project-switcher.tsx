"use client"

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import {
  ChevronDown,
  FolderOpen,
  Plus,
  Check,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Project } from "@/types"

type ProjectSwitcherProps = {
  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string) => void
  onNewProject?: (name: string) => void
}

function ProjectSwitcher({
  projects,
  selectedProjectId,
  onSelectProject,
  onNewProject,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [filterText, setFilterText] = useState("")
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const newProjectInputRef = useRef<HTMLInputElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  const currentProject = projects.find((p) => p.id === selectedProjectId)

  // Close on outside click
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      popoverRef.current &&
      !popoverRef.current.contains(e.target as Node) &&
      triggerRef.current &&
      !triggerRef.current.contains(e.target as Node)
    ) {
      setOpen(false)
      setIsCreating(false)
      setNewName("")
      setFilterText("")
    }
  }, [])

  // Outside click listener
  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      requestAnimationFrame(() => {
        filterInputRef.current?.focus()
      })
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open, handleClickOutside])

  useEffect(() => {
    if (isCreating) {
      newProjectInputRef.current?.focus()
    }
  }, [isCreating])

  const handleSelectProject = useCallback(
    (id: string) => {
      onSelectProject(id)
      setOpen(false)
      setFilterText("")
    },
    [onSelectProject],
  )

  const handleCreateSubmit = useCallback(() => {
    const trimmed = newName.trim()
    if (!trimmed || !onNewProject) return
    onNewProject(trimmed)
    setNewName("")
    setIsCreating(false)
    setOpen(false)
    setFilterText("")
  }, [newName, onNewProject])

  const handleCreateKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleCreateSubmit()
      } else if (e.key === "Escape") {
        setIsCreating(false)
        setNewName("")
      }
    },
    [handleCreateSubmit],
  )

  const filteredProjects = filterText
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(filterText.toLowerCase()),
      )
    : projects

  const dropdown = open && dropdownPos ? (
    <div
      ref={popoverRef}
      style={{ top: dropdownPos.top, left: dropdownPos.left }}
      className="fixed z-(--z-dropdown) bg-surface-raised border border-border-default rounded-lg shadow-lg min-w-[220px] max-w-[280px]"
    >
      {/* Filter input (shown when > 3 projects) */}
      {projects.length > 3 && (
        <div className="px-2 pt-2">
          <input
            ref={filterInputRef}
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search projects..."
            className="w-full px-2 py-1.5 text-xs bg-surface-sunken border border-border-default rounded-md outline-none text-default placeholder:text-muted focus:border-accent/40 transition-colors"
          />
        </div>
      )}

      {/* Project list */}
      <div className="p-1.5 max-h-[240px] overflow-y-auto">
        {filteredProjects.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted">
            No projects found
          </div>
        ) : (
          filteredProjects.map((project) => {
            const isCurrent = project.id === selectedProjectId
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => handleSelectProject(project.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors",
                  isCurrent
                    ? "bg-surface-sunken text-default"
                    : "text-secondary hover:text-default hover:bg-surface-sunken",
                )}
              >
                <span className="flex-1 text-left truncate">
                  {project.name}
                </span>
                {isCurrent && (
                  <Check className="h-3.5 w-3.5 text-accent shrink-0" />
                )}
              </button>
            )
          })
        )}
      </div>

      {/* New project */}
      {onNewProject && (
        <>
          <div className="mx-1.5 h-px bg-border-default" />
          <div className="p-1.5">
            {isCreating ? (
              <div className="flex items-center gap-1.5 rounded-md border-[0.5px] border-border-default bg-surface-sunken focus-within:border-accent/40 transition-colors px-2 py-1">
                <input
                  ref={newProjectInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={handleCreateKeyDown}
                  onBlur={() => {
                    setTimeout(() => {
                      if (!newName.trim()) {
                        setIsCreating(false)
                        setNewName("")
                      }
                    }, 150)
                  }}
                  placeholder="Project name..."
                  className="flex-1 bg-transparent border-none outline-none text-xs text-default placeholder:text-muted min-w-0"
                />
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false)
                    setNewName("")
                  }}
                  className="p-0.5 text-muted hover:text-secondary rounded transition-colors shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-secondary hover:text-default hover:bg-surface-sunken rounded transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                New project
              </button>
            )}
          </div>
        </>
      )}
    </div>
  ) : null

  return (
    <>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect()
            setDropdownPos({ top: rect.bottom + 6, left: rect.left })
          }
          setOpen((prev) => !prev)
        }}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors",
          "hover:bg-surface-raised/50",
          open && "bg-surface-raised/50",
        )}
      >
        <FolderOpen className="h-3.5 w-3.5 text-muted shrink-0" />
        <span className="text-sm font-medium text-default truncate max-w-[140px]">
          {currentProject?.name ?? "Select project"}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Portal the dropdown to body so it's not trapped in header stacking context */}
      {typeof document !== "undefined" && dropdown
        ? createPortal(dropdown, document.body)
        : null}
    </>
  )
}

export { ProjectSwitcher }
export type { ProjectSwitcherProps }
