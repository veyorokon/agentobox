"use client"

import { useState, useEffect, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "@apollo/client/react"
import { Plus, FolderOpen, ChevronRight, KeyRound } from "lucide-react"
import { GET_PROJECTS } from "@/lib/graphql/queries/projects"
import { CREATE_PROJECT } from "@/lib/graphql/mutations/projects"
import { GET_ACCOUNT_SECRETS } from "@/lib/graphql/queries/secrets"
import { SET_ACCOUNT_SECRET } from "@/lib/graphql/mutations/secrets"
import { createLogger } from "@/lib/logger"
import { cn } from "@/lib/utils"

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
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState("")
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null)

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

  const [createProject, { loading: creating }] = useMutation<{ createProject: { id: string } }>(CREATE_PROJECT)
  const [setAccountSecret] = useMutation(SET_ACCOUNT_SECRET, {
    refetchQueries: [{ query: GET_ACCOUNT_SECRETS }],
  })

  // Check if user already has an Anthropic API key at account level
  const { data: accountSecretsData } = useQuery<{ accountSecrets: { key: string }[] }>(GET_ACCOUNT_SECRETS, {
    skip: !authed,
  })
  const hasAccountKey = (accountSecretsData?.accountSecrets ?? []).some((s) => s.key === "ANTHROPIC_API_KEY")

  const projects = data?.projects ?? []

  // Detect credential type from API key input
  const credentialHint = apiKey.startsWith("sk-ant-oat") ? "oauth" as const
    : apiKey.startsWith("sk-ant-") ? "api_key" as const
    : null

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError("")
    try {
      // Save API key as account-level secret if provided
      if (apiKey.trim() && !hasAccountKey) {
        await setAccountSecret({
          variables: { input: { key: "ANTHROPIC_API_KEY", value: apiKey.trim() } },
        })
      }

      const { data: result } = await createProject({
        variables: { input: { name: name.trim(), description: description.trim() } },
      })
      const projectId = result?.createProject?.id
      if (!projectId) throw new Error("No project ID returned")
      setNavigatingTo(projectId)
      router.push(`/p/${projectId}`)
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
              {/* API key — only shown if no account-level key exists */}
              {!hasAccountKey && (
                <div>
                  <label htmlFor="project-api-key" className="flex items-center gap-1.5 text-xs font-medium text-secondary mb-1.5">
                    <KeyRound className="h-3 w-3" />
                    API Key
                  </label>
                  <input
                    id="project-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-sm font-mono text-default placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-muted/50">
                      Saved to your account — all projects inherit it
                    </span>
                    {credentialHint && (
                      <span
                        className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide",
                          credentialHint === "oauth"
                            ? "bg-accent/10 text-accent border border-accent/20"
                            : "bg-surface-sunken text-muted border border-border-default",
                        )}
                      >
                        {credentialHint === "oauth" ? "OAuth Token" : "API Key"}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {error && (
                <p className="text-[11px] text-red-400">{error}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={creating || navigatingTo !== null || !name.trim()}
                  className="rounded-md bg-accent px-4 py-1.5 text-[11px] font-medium text-on-emphasis hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  {navigatingTo ? "Opening..." : creating ? "Creating..." : "Create project"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setName(""); setDescription(""); setApiKey(""); setError("") }}
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
                disabled={navigatingTo !== null}
                onClick={() => {
                  setNavigatingTo(project.id)
                  router.push(`/p/${project.id}`)
                }}
                className={`w-full group flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${
                  navigatingTo === project.id
                    ? "border-accent/30 bg-accent/5"
                    : navigatingTo !== null
                      ? "opacity-40 pointer-events-none border-transparent"
                      : "border-transparent hover:border-border-default hover:bg-surface-raised/30"
                }`}
              >
                <div className={`h-8 w-8 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 uppercase ${
                  navigatingTo === project.id ? "bg-accent/20 text-accent" : "bg-accent/10 text-accent"
                }`}>
                  {navigatingTo === project.id ? (
                    <div className="h-3.5 w-3.5 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                  ) : (
                    project.name.charAt(0)
                  )}
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
                {navigatingTo === project.id ? (
                  <span className="text-[10px] text-accent/60 shrink-0">Opening...</span>
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted/30 group-hover:text-muted/60 transition-colors shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
