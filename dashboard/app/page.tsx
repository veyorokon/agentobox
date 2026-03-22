"use client"

import { useState, useEffect, useMemo, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "@apollo/client/react"
import {
  Plus,
  FolderOpen,
  ChevronRight,
  KeyRound,
  Trash2,
  Check,
  AlertTriangle,
  ChevronDown,
} from "lucide-react"
import { GET_PROJECTS } from "@/lib/graphql/queries/projects"
import { CREATE_PROJECT } from "@/lib/graphql/mutations/projects"
import { GET_AVAILABLE_MODELS } from "@/lib/graphql/queries/models"
import {
  useAccountSecrets,
  useSetAccountSecret,
  useDeleteAccountSecret,
  type SecretEntry,
} from "@/lib/graphql/hooks/use-secrets"
import { BackendStatusBanner } from "@/components/ui/backend-status-banner"
import { describeGraphqlError } from "@/lib/graphql/errors"
import { createLogger } from "@/lib/logger"
import { cn, timeAgo, formatDate, detectCredentialType, getBackendUrl } from "@/lib/utils"
import { getToken, clearTokenAndRedirect } from "@/lib/auth"

const log = createLogger("router")

type Project = {
  id: string
  name: string
  description: string
  createdAt: string
}

type ModelEntry = {
  value: string
  label: string
  provider: string
}

type SecretRow = {
  key: string
  value: string
}

type GlobalTab = "projects" | "secrets" | "personas"

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929"

// Provider → required secret key name. Mirrors backend PROVIDER_SECRET_KEYS.
const PROVIDER_KEY_NAMES: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  glm: "PROVIDER_KEY_GLM",
  kimi: "PROVIDER_KEY_KIMI",
  minimax: "PROVIDER_KEY_MINIMAX",
  qwen: "PROVIDER_KEY_QWEN",
  openrouter: "PROVIDER_KEY_OPENROUTER",
}

// Display names for provider buttons
const PROVIDER_PRESETS: { slug: string; name: string; keyName: string }[] = [
  { slug: "anthropic", name: "Anthropic", keyName: "ANTHROPIC_API_KEY" },
  { slug: "openrouter", name: "OpenRouter", keyName: "PROVIDER_KEY_OPENROUTER" },
  { slug: "glm", name: "GLM (Z.ai)", keyName: "PROVIDER_KEY_GLM" },
  { slug: "kimi", name: "Kimi", keyName: "PROVIDER_KEY_KIMI" },
  { slug: "minimax", name: "MiniMax", keyName: "PROVIDER_KEY_MINIMAX" },
  { slug: "qwen", name: "Qwen", keyName: "PROVIDER_KEY_QWEN" },
]

// Common app/service keys agents might need
const APP_PRESETS: { name: string; keyName: string }[] = [
  { name: "GitHub", keyName: "GITHUB_TOKEN" },
  { name: "GitLab", keyName: "GITLAB_TOKEN" },
  { name: "AWS Access Key", keyName: "AWS_ACCESS_KEY_ID" },
  { name: "AWS Secret Key", keyName: "AWS_SECRET_ACCESS_KEY" },
  { name: "Tavily", keyName: "TAVILY_API_KEY" },
  { name: "Slack", keyName: "SLACK_BOT_TOKEN" },
  { name: "Linear", keyName: "LINEAR_API_KEY" },
  { name: "Sentry", keyName: "SENTRY_AUTH_TOKEN" },
]

/* ================================================================== */
/*  GLOBAL PAGE                                                        */
/*                                                                     */
/*  Top-level view — manages projects and account-wide secrets.       */
/*  Tabs: Projects | Secrets                                           */
/* ================================================================== */

export default function GlobalPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [globalTab, setGlobalTab] = useState<GlobalTab>("projects")

  // ── Projects tab state ──
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const [pendingSecrets, setPendingSecrets] = useState<SecretRow[]>([])
  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [error, setError] = useState("")
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null)

  // ── Secrets tab state ──
  const [secretNewKey, setSecretNewKey] = useState("")
  const [secretNewValue, setSecretNewValue] = useState("")

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login")
    } else {
      setAuthed(true)
    }
  }, [router])

  const { data, loading, error: projectsError, refetch: refetchProjects } = useQuery<{ projects: Project[] }>(GET_PROJECTS, {
    skip: !authed,
    fetchPolicy: "network-only",
  })

  const [createProject, { loading: creating }] = useMutation<{ createProject: { id: string } }>(CREATE_PROJECT)

  // Secrets hooks (for inline secrets tab)
  const { data: accountSecretsData } = useAccountSecrets(!authed)
  const accountSecrets: SecretEntry[] = accountSecretsData?.accountSecrets ?? []
  const accountKeySet = useMemo(() => new Set(accountSecrets.map((s) => s.key)), [accountSecrets])
  const setAccountSecret = useSetAccountSecret()
  const deleteAccountSecret = useDeleteAccountSecret()

  const { data: modelsData } = useQuery<{ availableModels: ModelEntry[] }>(GET_AVAILABLE_MODELS, {
    skip: !authed,
    fetchPolicy: "cache-first",
  })
  const models = modelsData?.availableModels ?? []

  // Group models by provider for the dropdown
  const modelsByProvider = useMemo(() => {
    const groups: Record<string, ModelEntry[]> = {}
    for (const m of models) {
      const p = m.provider || "other"
      if (!groups[p]) groups[p] = []
      groups[p].push(m)
    }
    return groups
  }, [models])

  // Determine required key for selected model
  const selectedModelEntry = models.find((m) => m.value === selectedModel)
  const selectedProvider = selectedModelEntry?.provider ?? "anthropic"
  const requiredKeyName = PROVIDER_KEY_NAMES[selectedProvider] ?? null

  // Check if required key is satisfied (account-level or in pending secrets)
  const pendingKeySet = useMemo(() => new Set(pendingSecrets.map((s) => s.key)), [pendingSecrets])
  const requiredKeySatisfied = requiredKeyName
    ? accountKeySet.has(requiredKeyName) || pendingKeySet.has(requiredKeyName)
    : true

  const projects = data?.projects ?? []

  // Credential hint for secrets tab input
  const secretCredentialHint = useMemo(
    () => detectCredentialType(secretNewKey, secretNewValue),
    [secretNewKey, secretNewValue],
  )

  // Filter presets as user types in the key field
  const secretFilter = secretNewKey.trim().toLowerCase()
  const filteredProviders = useMemo(
    () => secretFilter
      ? PROVIDER_PRESETS.filter((p) => p.name.toLowerCase().includes(secretFilter) || p.keyName.toLowerCase().includes(secretFilter))
      : PROVIDER_PRESETS,
    [secretFilter],
  )
  const filteredApps = useMemo(
    () => secretFilter
      ? APP_PRESETS.filter((p) => p.name.toLowerCase().includes(secretFilter) || p.keyName.toLowerCase().includes(secretFilter))
      : APP_PRESETS,
    [secretFilter],
  )

  // ── Secret row management (create form) ──

  const handleAddSecret = () => {
    const key = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "")
    const value = newValue.trim()
    if (!key || !value) return
    setPendingSecrets((prev) => [...prev.filter((s) => s.key !== key), { key, value }])
    setNewKey("")
    setNewValue("")
  }

  const handleRemoveSecret = (key: string) => {
    setPendingSecrets((prev) => prev.filter((s) => s.key !== key))
  }

  // Auto-suggest required key when model changes (only if key is missing)
  const secretsLoaded = !!accountSecretsData
  const keyMissing = secretsLoaded && !!requiredKeyName && !accountKeySet.has(requiredKeyName) && !pendingKeySet.has(requiredKeyName)
  useEffect(() => {
    if (keyMissing) {
      setNewKey(requiredKeyName!)
      setShowSecrets(true)
    }
  }, [keyMissing, requiredKeyName])

  // Secrets section expand/collapse — auto-expand when key is missing
  const [showSecrets, setShowSecrets] = useState(false)

  // ── Secrets tab handlers ──

  const handleSecretTabAdd = async () => {
    if (!secretNewKey.trim() || !secretNewValue.trim()) return
    const key = secretNewKey.trim().toUpperCase()
    const value = secretNewValue.trim()
    await setAccountSecret(key, value)
    setSecretNewKey("")
    setSecretNewValue("")
  }

  const handleSecretTabDelete = async (key: string) => {
    await deleteAccountSecret(key)
  }

  // ── Form submission ──

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError("")
    try {
      // Save all pending secrets as account-level (parallel)
      if (pendingSecrets.length > 0) {
        await Promise.all(pendingSecrets.map((s) => setAccountSecret(s.key, s.value)))
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

  const handleReset = () => {
    setShowCreate(false)
    setName("")
    setDescription("")
    setSelectedModel(DEFAULT_MODEL)
    setPendingSecrets([])
    setNewKey("")
    setNewValue("")
    setError("")
    setShowSecrets(false)
  }

  // Wait for auth check
  if (authed === null) return null

  const TABS: { id: GlobalTab; label: string }[] = [
    { id: "projects", label: "Projects" },
    { id: "secrets", label: "Secrets" },
    { id: "personas", label: "Personas" },
  ]

  return (
    <div className="min-h-screen bg-surface">
      {projectsError && (
        <BackendStatusBanner
          title="Projects are temporarily unavailable"
          detail={describeGraphqlError(projectsError)}
          onRetry={() => { void refetchProjects() }}
        />
      )}
      {/* Header */}
      <header className="h-12 px-6 flex items-center border-b border-border-default">
        <h1 className="text-sm font-semibold text-default">Agentobox</h1>
        <span className="flex-1" />

        {/* Centered global tabs */}
        <nav className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setGlobalTab(tab.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                globalTab === tab.id
                  ? "bg-surface-raised text-default"
                  : "text-muted hover:text-secondary hover:bg-surface-raised/30",
              )}
            >
              {tab.label}
              {tab.id === "secrets" && accountSecrets.length > 0 && (
                <span className="ml-1.5 text-[9px] text-muted/60 tabular-nums">
                  {accountSecrets.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            const backendUrl = getBackendUrl()
            fetch(`${backendUrl}/_allauth/browser/v1/auth/session`, {
              method: "DELETE",
              credentials: "include",
            }).catch(() => {})
            clearTokenAndRedirect("user_signout")
          }}
          className="text-[11px] text-muted hover:text-secondary transition-colors"
        >
          Sign out
        </button>
      </header>

      {/* ── Projects tab ── */}
      {globalTab === "projects" && (
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

          {/* ── Create form ── */}
          {showCreate && (
            <form
              onSubmit={handleCreate}
              className="mb-6 rounded-lg border border-border-default bg-surface-raised/30 overflow-hidden"
            >
              {/* Section 1: Project info */}
              <div className="p-4 space-y-3">
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
              </div>

              {/* Section 2: Team lead model */}
              <div className="px-4 pb-3">
                <label htmlFor="lead-model" className="block text-xs font-medium text-secondary mb-1.5">
                  Team Lead Model
                </label>
                <div className="relative">
                  <select
                    id="lead-model"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full appearance-none rounded-md border border-border-default bg-surface-sunken px-3 py-2 pr-8 text-sm text-default focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {Object.entries(modelsByProvider).map(([provider, providerModels]) => (
                      <optgroup key={provider} label={provider.charAt(0).toUpperCase() + provider.slice(1)}>
                        {providerModels.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted/50 pointer-events-none" />
                </div>
                {requiredKeyName && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {requiredKeySatisfied ? (
                      <>
                        <Check className="h-2.5 w-2.5 text-success" />
                        <span className="text-[10px] text-success">
                          <span className="font-mono">{requiredKeyName}</span> configured
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-2.5 w-2.5 text-warning" />
                        <span className="text-[10px] text-warning">
                          Requires <span className="font-mono">{requiredKeyName}</span>
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Section 3: Secrets — collapsed when all keys satisfied */}
              <div className="border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="w-full px-4 py-2.5 flex items-center gap-1.5 hover:bg-surface-sunken/30 transition-colors"
                >
                  <KeyRound className="h-3 w-3 text-muted" />
                  <span className="text-xs font-medium text-secondary">Secrets</span>
                  {accountSecrets.length > 0 && (
                    <span className="text-[10px] text-muted/50 ml-0.5">
                      {accountSecrets.length} configured
                    </span>
                  )}
                  {pendingSecrets.length > 0 && (
                    <span className="text-[10px] text-accent/60 font-medium">
                      +{pendingSecrets.length} new
                    </span>
                  )}
                  <ChevronDown className={cn(
                    "h-3 w-3 text-muted/40 ml-auto transition-transform",
                    showSecrets && "rotate-180",
                  )} />
                </button>

                {showSecrets && (
                  <div className="px-4 pb-3 space-y-2">
                    {/* Existing account secrets */}
                    {accountSecrets.length > 0 && (
                      <div className="space-y-px">
                        {accountSecrets.map((s) => (
                          <div
                            key={s.key}
                            className="flex items-center gap-2 py-1"
                          >
                            <Check className="h-2.5 w-2.5 text-success/60 shrink-0" />
                            <span className="text-[11px] font-mono text-default/70">{s.key}</span>
                            <span className="text-[9px] text-muted/40 font-mono">{"●".repeat(8)}</span>
                            <span className="text-[9px] text-muted/40 italic ml-auto">global</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Pending secrets (to be saved on create) */}
                    {pendingSecrets.length > 0 && (
                      <div className="space-y-px">
                        {pendingSecrets.map((s) => {
                          const credHint = detectCredentialType(s.key, s.value)
                          return (
                            <div
                              key={s.key}
                              className="group flex items-center gap-2 py-1"
                            >
                              <div className="h-2.5 w-2.5 rounded-full bg-accent/30 shrink-0" />
                              <span className="text-[11px] font-mono text-default">{s.key}</span>
                              <span className="text-[9px] text-muted/40 font-mono">{"●".repeat(8)}</span>
                              {credHint && (
                                <span
                                  className={cn(
                                    "inline-flex items-center px-1 py-0.5 rounded text-[9px] font-mono font-medium tracking-wide",
                                    credHint === "oauth"
                                      ? "bg-accent/10 text-accent border border-accent/20"
                                      : "bg-surface-sunken text-muted border border-border-default",
                                  )}
                                >
                                  {credHint === "oauth" ? "OAuth" : "API Key"}
                                </span>
                              )}
                              <span className="text-[9px] text-accent/50 italic ml-auto mr-1">new</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveSecret(s.key)}
                                className="p-0.5 rounded text-muted/30 hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Add secret row */}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                        placeholder="KEY_NAME"
                        className="flex-1 min-w-0 bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
                      />
                      <input
                        type="password"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        placeholder="value"
                        autoComplete="off"
                        data-1p-ignore
                        className="flex-1 min-w-0 bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={handleAddSecret}
                        disabled={!newKey.trim() || !newValue.trim()}
                        className={cn(
                          "px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0",
                          newKey.trim() && newValue.trim()
                            ? "bg-accent text-on-emphasis hover:bg-accent-hover"
                            : "bg-surface-sunken text-muted cursor-not-allowed",
                        )}
                      >
                        Add
                      </button>
                    </div>

                    {/* Credential hint for current input */}
                    {newKey && newValue && (() => {
                      const hint = detectCredentialType(newKey, newValue)
                      if (!hint) return null
                      return (
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide",
                              hint === "oauth"
                                ? "bg-accent/10 text-accent border border-accent/20"
                                : "bg-surface-sunken text-muted border border-border-default",
                            )}
                          >
                            {hint === "oauth" ? "OAuth Token" : "API Key"}
                          </span>
                          {hint === "oauth" && (
                            <span className="text-[10px] text-muted/50">
                              via <span className="font-mono">claude setup-token</span>
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>

              {/* Form actions */}
              <div className="px-4 py-3 border-t border-border-subtle flex items-center gap-2">
                {error && (
                  <p className="text-[11px] text-red-400 flex-1">{error}</p>
                )}
                {!error && <span className="flex-1" />}
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-[11px] text-muted hover:text-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || navigatingTo !== null || !name.trim() || !requiredKeySatisfied}
                  className="rounded-md bg-accent px-4 py-1.5 text-[11px] font-medium text-on-emphasis hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  {navigatingTo ? "Opening..." : creating ? "Creating..." : "Create project"}
                </button>
              </div>
            </form>
          )}

          {/* ── Project list ── */}
          {projectsError && projects.length === 0 ? (
            <div className="py-16 text-center">
              <AlertTriangle className="h-8 w-8 text-danger/30 mx-auto mb-3" />
              <p className="text-sm text-danger/75 mb-1">Backend unavailable</p>
              <p className="text-[11px] text-muted/55">{describeGraphqlError(projectsError)}</p>
            </div>
          ) : loading && projects.length === 0 ? (
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
      )}

      {/* ── Personas tab (placeholder) ── */}
      {globalTab === "personas" && (
        <div className="max-w-2xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-medium text-secondary uppercase tracking-wider">Personas</h2>
          </div>
          <div className="py-16 text-center rounded-lg border border-border-default bg-surface-raised/30">
            <p className="text-sm text-muted/60 mb-1">Coming soon</p>
            <p className="text-[11px] text-muted/40">Reusable identity templates with instructions and tags for agents</p>
          </div>
        </div>
      )}

      {/* ── Secrets tab ── */}
      {globalTab === "secrets" && (
        <div className="max-w-2xl mx-auto px-6 py-8">
          {/* Single unified card */}
          <div className="rounded-lg border border-border-default bg-surface-raised/30 overflow-hidden">

            {/* ── Input form (top, always visible) ── */}
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={secretNewKey}
                  onChange={(e) => setSecretNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                  placeholder="KEY_NAME"
                  className="flex-1 min-w-0 bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
                />
                <input
                  type="password"
                  value={secretNewValue}
                  onChange={(e) => setSecretNewValue(e.target.value)}
                  placeholder="value"
                  autoComplete="off"
                  data-1p-ignore
                  className="flex-1 min-w-0 bg-surface-sunken/60 border border-border-default rounded-md px-2.5 py-1.5 text-xs font-mono text-default placeholder:text-muted/40 outline-none focus:border-accent/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={handleSecretTabAdd}
                  disabled={!secretNewKey.trim() || !secretNewValue.trim()}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0",
                    secretNewKey.trim() && secretNewValue.trim()
                      ? "bg-accent text-on-emphasis hover:bg-accent-hover"
                      : "bg-surface-sunken text-muted cursor-not-allowed",
                  )}
                >
                  Add
                </button>
              </div>

              {/* Credential hint */}
              {secretCredentialHint && (
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide",
                      secretCredentialHint === "oauth"
                        ? "bg-accent/10 text-accent border border-accent/20"
                        : "bg-surface-sunken text-muted border border-border-default",
                    )}
                  >
                    {secretCredentialHint === "oauth" ? "OAuth Token" : "API Key"}
                  </span>
                  {secretCredentialHint === "oauth" && (
                    <span className="text-[10px] text-muted/50">
                      via <span className="font-mono">claude setup-token</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── Preset quick-fill buttons ── */}
            {(filteredProviders.length > 0 || filteredApps.length > 0) && (
              <div className="px-4 pb-3 space-y-1">
                {filteredProviders.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                    <span className="text-[9px] uppercase tracking-widest text-muted/40 mr-1">Providers</span>
                    {filteredProviders.map((p) => {
                      const configured = accountKeySet.has(p.keyName)
                      return (
                        <button
                          key={p.slug}
                          type="button"
                          disabled={configured}
                          onClick={() => { if (!configured) setSecretNewKey(p.keyName) }}
                          className={cn(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                            configured
                              ? "text-success/60 cursor-default"
                              : "text-muted/50 hover:text-accent hover:bg-accent/5",
                          )}
                        >
                          {configured && <Check className="h-2 w-2" />}
                          {p.name}
                        </button>
                      )
                    })}
                  </div>
                )}
                {filteredApps.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                    <span className="text-[9px] uppercase tracking-widest text-muted/40 mr-1">Services</span>
                    {filteredApps.map((p) => {
                      const configured = accountKeySet.has(p.keyName)
                      return (
                        <button
                          key={p.keyName}
                          type="button"
                          disabled={configured}
                          onClick={() => { if (!configured) setSecretNewKey(p.keyName) }}
                          className={cn(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                            configured
                              ? "text-success/60 cursor-default"
                              : "text-muted/50 hover:text-accent hover:bg-accent/5",
                          )}
                        >
                          {configured && <Check className="h-2 w-2" />}
                          {p.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Secrets list ── */}
            {accountSecrets.length === 0 ? (
              <div className="px-4 py-6 text-center border-t border-border-subtle">
                <p className="text-[11px] text-muted/40">No secrets yet — click a provider above or type a key name</p>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle border-t border-border-subtle">
                {accountSecrets.map((secret) => (
                  <div
                    key={secret.id}
                    className="group flex items-center gap-3 px-4 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-mono font-medium text-default truncate">
                          {secret.key}
                        </span>
                        <span className="text-[9px] text-muted/30 font-mono">
                          {"●".repeat(8)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[9px] text-muted/30 font-mono tabular-nums shrink-0">
                      {timeAgo(secret.updatedAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSecretTabDelete(secret.key)}
                      className="p-1 rounded text-muted/20 hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete secret"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Subtle footer note */}
          <p className="text-[10px] text-muted/30 mt-2 px-1">
            Account secrets are inherited by all projects
          </p>
        </div>
      )}
    </div>
  )
}
