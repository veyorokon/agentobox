"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Search, FolderOpen, Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSearch } from "@/components/shared/search-provider"
import { useUIStore } from "@/stores/ui"
import type { Project, Agent } from "@/types"

type SearchOverlayProps = {
  projects: Project[]
  agents: Agent[]
}

type SearchResult = {
  id: string
  name: string
  type: "project" | "agent"
}

function SearchOverlay({ projects, agents }: SearchOverlayProps) {
  const { isOpen, close } = useSearch()
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const selectProject = useUIStore((s) => s.selectProject)
  const selectAgent = useUIStore((s) => s.selectAgent)

  const results = useMemo<SearchResult[]>(() => {
    const q = query.toLowerCase().trim()
    if (!q) {
      // Show all items when no query
      return [
        ...projects.map((p) => ({ id: p.id, name: p.name, type: "project" as const })),
        ...agents.map((a) => ({ id: a.id, name: a.name, type: "agent" as const })),
      ]
    }
    const matchedProjects = projects
      .filter((p) => p.name.toLowerCase().includes(q))
      .map((p) => ({ id: p.id, name: p.name, type: "project" as const }))
    const matchedAgents = agents
      .filter((a) => a.name.toLowerCase().includes(q))
      .map((a) => ({ id: a.id, name: a.name, type: "agent" as const }))
    return [...matchedProjects, ...matchedAgents]
  }, [query, projects, agents])

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("")
      setSelectedIndex(0)
      // Small delay to ensure the input is rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [isOpen])

  // Keep selectedIndex in bounds
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1))
    }
  }, [results.length, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll("[data-search-item]")
    items[selectedIndex]?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  const handleSelect = useCallback(
    (result: SearchResult) => {
      close()
      if (result.type === "project") {
        selectProject(result.id)
        router.push(`/${result.id}`)
      } else {
        selectAgent(result.id)
      }
    },
    [close, selectProject, selectAgent, router],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < results.length - 1 ? prev + 1 : 0,
          )
          break
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : results.length - 1,
          )
          break
        case "Enter":
          e.preventDefault()
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex])
          }
          break
        case "Escape":
          e.preventDefault()
          close()
          break
      }
    },
    [results, selectedIndex, handleSelect, close],
  )

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-bg-400/60 backdrop-blur-sm flex items-start justify-center pt-[20vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="max-w-lg w-full bg-bg-000 rounded-xl border border-border-300 shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-300">
          <Search className="h-4 w-4 text-text-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Search projects and agents..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-100 placeholder:text-text-500"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-text-400 bg-bg-200 border border-border-300 rounded">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-400">
              No results found
            </div>
          ) : (
            results.map((result, index) => (
              <button
                key={`${result.type}-${result.id}`}
                data-search-item
                type="button"
                onClick={() => handleSelect(result)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                  index === selectedIndex
                    ? "bg-bg-200 text-text-100"
                    : "text-text-300 hover:bg-bg-100",
                )}
              >
                {result.type === "project" ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-text-400" />
                ) : (
                  <Bot className="h-4 w-4 shrink-0 text-text-400" />
                )}
                <span className="flex-1 text-sm truncate">{result.name}</span>
                <span
                  className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded",
                    result.type === "project"
                      ? "bg-accent-main-000/10 text-accent-main-000"
                      : "bg-bg-300 text-text-400",
                  )}
                >
                  {result.type === "project" ? "Project" : "Agent"}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border-300 flex items-center gap-3 text-[10px] text-text-500">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-bg-200 border border-border-300 rounded">
              &uarr;&darr;
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-bg-200 border border-border-300 rounded">
              &crarr;
            </kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-bg-200 border border-border-300 rounded">
              esc
            </kbd>
            close
          </span>
        </div>
      </div>
    </div>
  )
}

export { SearchOverlay }
export type { SearchOverlayProps }
