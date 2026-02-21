"use client"

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react"
import { Plus, Search, SlidersHorizontal, X, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarItem } from "@/components/layout/sidebar-item"
import type { Project } from "@/types"

type SidebarProps = {
  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string) => void
  onNewProject?: (name: string) => void
  username?: string | null
}

function Sidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onNewProject,
  username,
}: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isCreating) {
      inputRef.current?.focus()
    }
  }, [isCreating])

  const handleSubmit = useCallback(() => {
    const trimmed = newName.trim()
    if (!trimmed || !onNewProject) return
    onNewProject(trimmed)
    setNewName("")
    setIsCreating(false)
  }, [newName, onNewProject])

  const handleCancel = useCallback(() => {
    setNewName("")
    setIsCreating(false)
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === "Escape") {
        handleCancel()
      }
    },
    [handleSubmit, handleCancel],
  )

  return (
    <div className="w-[260px] h-full bg-bg-200 border-r-[0.5px] border-border-300 flex flex-col">
      <div className="flex-1 flex flex-col bg-bg-100 m-0 min-h-0">
        <div className="px-4 py-3">
          <span className="text-sm font-semibold text-text-000">Agentobox</span>
        </div>

        {onNewProject && !isCreating && (
          <div className="mx-3 mb-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setIsCreating(true)}
            >
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </div>
        )}

        {isCreating && (
          <div className="mx-3 mb-2">
            <div className="flex items-center gap-1.5 rounded-md border-[0.5px] border-border-300 bg-bg-000/60 focus-within:bg-bg-000 focus-within:border-accent-main-000/40 transition-colors px-2 py-1">
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  setTimeout(() => {
                    if (!newName.trim()) handleCancel()
                  }, 150)
                }}
                placeholder="Project name..."
                className="flex-1 bg-transparent border-none outline-none text-sm text-text-100 placeholder:text-text-500 min-w-0"
              />
              <button
                type="button"
                onClick={handleCancel}
                className="p-0.5 text-text-400 hover:text-text-200 rounded transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs text-text-400 font-medium">Sessions</span>
          <div className="flex items-center gap-1">
            <button
              className="p-1 text-text-400 rounded transition-colors opacity-50 cursor-not-allowed"
              aria-label="Search (coming soon)"
              disabled
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            <button
              className="p-1 text-text-400 rounded transition-colors opacity-50 cursor-not-allowed"
              aria-label="Filters (coming soon)"
              disabled
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0.5 pb-2">
            {projects.map((project) => (
              <SidebarItem
                key={project.id}
                project={project}
                isActive={project.id === selectedProjectId}
                onClick={() => onSelectProject(project.id)}
              />
            ))}
          </div>
        </ScrollArea>

        {/* User avatar + settings — bottom of sidebar like Claude Code */}
        <div className="px-3 py-2 flex items-center justify-between shrink-0 border-t border-border-300">
          <div className="h-6 w-6 rounded-full bg-accent-main-000 flex items-center justify-center text-[10px] text-oncolor-100 font-medium uppercase cursor-pointer">
            {username?.charAt(0) ?? "?"}
          </div>
          <button
            type="button"
            className="p-1 text-text-400 rounded transition-colors opacity-50 cursor-not-allowed"
            aria-label="Settings (coming soon)"
            disabled
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export { Sidebar }
export type { SidebarProps }
