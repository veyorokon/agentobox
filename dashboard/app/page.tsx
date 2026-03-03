"use client"

import { useState, useEffect, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "@apollo/client"
import { Plus, FolderOpen, ChevronRight } from "lucide-react"
import { GET_PROJECTS } from "@/lib/graphql/queries/projects"
import { CREATE_PROJECT } from "@/lib/graphql/mutations/projects"
import { createLogger } from "@/lib/logger"

const log = createLogger("router")

type Project = {
  id: string
  name: string
  description: string
  createdAt: string
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function HomePage() {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const token = localStorage.getItem("auth_token")
    if (!token) {
      router.replace("/login")
    } else {
      setAuthed(true)
    }
  }, [router])

  const { data, loading } = useQuery<{ projects: Project[] }>(GET_PROJECTS, {
    skip: !authed,
    fetchPolicy: "network-only",
  })

  const [createProject, { loading: creating }] = useMutation(CREATE_PROJECT)

  const projects = data?.projects ?? []

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError("")
    try {
      const { data: result } = await createProject({
        variables: { input: { name: name.trim(), description: description.trim() } },
      })
      router.push(`/p/${result.createProject.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create project"
      setError(msg)
      log("project.create_failed", { message: msg }, "error")
    }
  }

  // Wait for auth check
  if (authed === null) return null

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="h-12 px-6 flex items-center border-b border-border-default">
        <h1 className="text-sm font-semibold text-default">Agentobox</h1>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem("auth_token")
            router.replace("/login")
          }}
          className="text-[11px] text-muted hover:text-secondary transition-colors"
        >
          Sign out
        </button>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Title + create button */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xs font-medium text-secondary uppercase tracking-wider">Projects</h2>
          <button
            type="button"
            onClick={() => setShowCreate(!showCreate)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-[11px] font-medium text-on-emphasis hover:bg-accent/90 transition-colors"
          >
            <Plus className="h-3 w-3" />
            New Project
          </button>
        </div>

        {/* Inline create form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 p-4 rounded-lg border border-border-default bg-surface-raised/30"
          >
            <div className="space-y-3">
              <div>
                <label htmlFor="project-name" className="block text-xs font-medium text-secondary mb-1.5">
                  Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-project"
                  required
                  autoFocus
                  className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-sm text-default placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label htmlFor="project-desc" className="block text-xs font-medium text-secondary mb-1.5">
                  Description
                  <span className="text-muted/50 ml-1 font-normal">optional</span>
                </label>
                <input
                  id="project-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this project about?"
                  className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-sm text-default placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              {error && (
                <p className="text-[11px] text-red-400">{error}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={creating || !name.trim()}
                  className="rounded-md bg-accent px-4 py-1.5 text-[11px] font-medium text-on-emphasis hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create project"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setName(""); setDescription(""); setError("") }}
                  className="text-[11px] text-muted hover:text-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Project list */}
        {loading && projects.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[11px] text-muted/50">Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="py-16 text-center">
            <FolderOpen className="h-8 w-8 text-muted/20 mx-auto mb-3" />
            <p className="text-sm text-muted/60 mb-1">No projects yet</p>
            <p className="text-[11px] text-muted/40">Create your first project to get started</p>
          </div>
        ) : (
          <div className="space-y-1">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => router.push(`/p/${project.id}`)}
                className="w-full group flex items-center gap-3 px-4 py-3 rounded-lg border border-transparent hover:border-border-default hover:bg-surface-raised/30 transition-all text-left"
              >
                <div className="h-8 w-8 rounded-md bg-accent/10 flex items-center justify-center text-[11px] font-bold text-accent shrink-0 uppercase">
                  {project.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-default truncate">{project.name}</div>
                  {project.description && (
                    <div className="text-[11px] text-muted/60 truncate mt-0.5">{project.description}</div>
                  )}
                </div>
                <span className="text-[10px] text-muted/40 tabular-nums shrink-0">
                  {formatDate(project.createdAt)}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted/30 group-hover:text-muted/60 transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
