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
import { GET_ACCOUNT_SECRETS } from "@/lib/graphql/queries/secrets"
import { SET_ACCOUNT_SECRET } from "@/lib/graphql/mutations/secrets"
import { GET_AVAILABLE_MODELS } from "@/lib/graphql/queries/models"
import {
  useAccountSecrets,
  useSetAccountSecret,
  useDeleteAccountSecret,
} from "@/lib/graphql/hooks/use-secrets"
import { createLogger } from "@/lib/logger"
import { cn } from "@/lib/utils"

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

type SecretEntry = {
  id: string
  key: string
  createdAt: string
  updatedAt: string
}

type GlobalTab = "projects" | "secrets" | "personas"

// Provider → required secret key name. Mirrors backend PROVIDER_SECRET_KEYS.
const PROVIDER_KEY_NAMES: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  glm: "PROVIDER_KEY_GLM",
  kimi: "PROVIDER_KEY_KIMI",
  minimax: "PROVIDER_KEY_MINIMAX",
  qwen: "PROVIDER_KEY_QWEN",
  openrouter: "PROVIDER_KEY_OPENROUTER",
}

// Credential type detection from value prefix
function detectCredentialType(key: string, value: string): "oauth" | "api_key" | null {
  if (key !== "ANTHROPIC_API_KEY" || !value.trim()) return null
  if (value.startsWith("sk-ant-oat")) return "oauth"
  if (value.startsWith("sk-ant-")) return "api_key"
  return null
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

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
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-5-20250929")
  const [secrets, setSecrets] = useState<SecretRow[]>([])
  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [error, setError] = useState("")
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null)

  // ── Secrets tab state ──
  const [secretNewKey, setSecretNewKey] = useState("")
  const [secretNewValue, setSecretNewValue] = useState("")

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
  const [setAccountSecretMutation] = useMutation(SET_ACCOUNT_SECRET, {
    refetchQueries: [{ query: GET_ACCOUNT_SECRETS }],
  })

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
  const pendingKeySet = useMemo(() => new Set(secrets.map((s) => s.key)), [secrets])
  const requiredKeySatisfied = requiredKeyName
    ? accountKeySet.has(requiredKeyName) || pendingKeySet.has(requiredKeyName)
    : true

  const projects = data?.projects ?? []

  // Credential hint for secrets tab input
  const secretCredentialHint = useMemo(() => {
    if (secretNewKey !== "ANTHROPIC_API_KEY" || !secretNewValue.trim()) return null
    if (secretNewValue.startsWith("sk-ant-oat")) return "oauth" as const
    if (secretNewValue.startsWith("sk-ant-")) return "api_key" as const
    return null
  }, [secretNewKey, secretNewValue])

  // ── Secret row management (create form) ──

  const handleAddSecret = () => {
    const key = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "")
    const value = newValue.trim()
    if (!key || !value) return
    setSecrets((prev) => [...prev.filter((s) => s.key !== key), { key, value }])
    setNewKey("")
    setNewValue("")
  }

  const handleRemoveSecret = (key: string) => {
    setSecrets((prev) => prev.filter((s) => s.key !== key))
  }

  // Auto-suggest required key when model changes
  useEffect(() => {
    if (requiredKeyName && !accountKeySet.has(requiredKeyName) && !pendingKeySet.has(requiredKeyName)) {
      setNewKey(requiredKeyName)
    }
  }, [requiredKeyName, accountKeySet, pendingKeySet])

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
      // Save all pending secrets as account-level
      for (const secret of secrets) {
        await setAccountSecretMutation({
          variables: { input: { key: secret.key, value: secret.value } },
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

  const handleReset = () => {
    setShowCreate(false)
    setName("")
    setDescription("")
    setSelectedModel("claude-sonnet-4-5-20250929")
    setSecrets([])
    setNewKey("")
    setNewValue("")
    setError("")
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
            localStorage.removeItem("auth_token")
            router.replace("/login")
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

              {/* Section 3: Secrets */}
              <div className="border-t border-border-subtle">
                <div className="px-4 pt-3 pb-2">
                  <div className="flex items-center gap-1.5 mb-2">
                    <KeyRound className="h-3 w-3 text-muted" />
                    <span className="text-xs font-medium text-secondary">Secrets</span>
                    <span className="text-[10px] text-muted/50 ml-1">saved to your account — all projects inherit</span>
                  </div>

                  {/* Existing account secrets */}
                  {accountSecrets.length > 0 && (
                    <div className="mb-2 space-y-px">
                      {accountSecrets.map((s) => (
                        <div
                          key={s.key}
                          className="flex items-center gap-2 py-1.5"
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
                  {secrets.length > 0 && (
                    <div className="mb-2 space-y-px">
                      {secrets.map((s) => {
                        const credHint = detectCredentialType(s.key, s.value)
                        return (
                          <div
                            key={s.key}
                            className="group flex items-center gap-2 py-1.5"
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
                  <div className="flex items-center gap-2">
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
                      <div className="flex items-center gap-2 mt-1.5">
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
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-xs font-medium text-secondary uppercase tracking-wider">Account Secrets</h2>
            <span className="text-[10px] text-muted/40">inherited by all projects</span>
          </div>

          {/* Secrets list */}
          <div className="rounded-lg border border-border-default bg-surface-raised/30 overflow-hidden">
            {accountSecrets.length === 0 ? (
              <div className="py-12 text-center">
                <KeyRound className="h-8 w-8 text-muted/20 mx-auto mb-2" />
                <p className="text-xs text-muted/50">No secrets configured</p>
                <p className="text-[10px] text-muted/30 mt-1">Add API keys and tokens that all projects can use</p>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {accountSecrets.map((secret) => (
                  <div
                    key={secret.id}
                    className="group flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-medium text-default truncate">
                          {secret.key}
                        </span>
                        <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium tracking-wide bg-accent/8 text-accent/70 border border-accent/15 shrink-0">
                          account
                        </span>
                      </div>
                      <span className="text-[10px] text-muted/50 font-mono">
                        {timeAgo(secret.updatedAt)}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-muted/40">
                      {"●".repeat(12)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSecretTabDelete(secret.key)}
                      className="p-1 rounded text-muted/30 hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete secret"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add secret form */}
            <div className="px-4 py-3 border-t border-border-subtle">
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

              {/* Credential hint + account label */}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[10px] text-muted/50">saved to your account — all projects inherit</span>
                {secretCredentialHint && (
                  <div className="flex items-center gap-2">
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
