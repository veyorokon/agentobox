"use client"

import { useState, useEffect, type FormEvent } from "react"
import { useParams } from "next/navigation"
import { useMutation } from "@apollo/client"
import { X } from "lucide-react"
import { CREATE_AGENT } from "@/lib/graphql/mutations/agents"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { TagInput } from "@/components/agent/tag-input"

const MODEL_OPTIONS = [
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const

const ROLE_OPTIONS = [
  { value: "worker", label: "Worker" },
  { value: "lead", label: "Lead" },
] as const

const MODE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "plan", label: "Plan" },
  { value: "supervised", label: "Supervised" },
] as const

export function CreateAgentModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { projectId } = useParams<{ projectId: string }>()
  const [name, setName] = useState("")
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].value)
  const [role, setRole] = useState<string>(ROLE_OPTIONS[0].value)
  const [mode, setMode] = useState<string>(MODE_OPTIONS[0].value)
  const [instructions, setInstructions] = useState("")
  const [tags, setTags] = useState<string[]>([])

  const [createAgent, { loading, error }] = useMutation(CREATE_AGENT, {
    refetchQueries: [{ query: GET_AGENTS, variables: { projectId } }],
  })

  // Escape to close
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  // Reset form on open
  useEffect(() => {
    if (open) {
      setName("")
      setModel(MODEL_OPTIONS[0].value)
      setRole(ROLE_OPTIONS[0].value)
      setMode(MODE_OPTIONS[0].value)
      setInstructions("")
      setTags([])
    }
  }, [open])

  if (!open) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !projectId) return
    try {
      await createAgent({
        variables: {
          input: {
            projectId,
            name: name.trim(),
            model,
            role,
            mode,
            runtime: "docker",
            instructions: instructions.trim() || undefined,
            tags: tags.length > 0 ? tags : undefined,
          },
        },
      })
      onClose()
    } catch {
      // Error displayed via `error` state
    }
  }

  return (
    <div
      className="fixed inset-0 z-(--z-overlay) bg-black/50 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface border border-border-default rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="h-10 px-4 flex items-center justify-between border-b border-border-default">
          <h2 className="text-sm font-medium text-default">Create Agent</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="agent-name" className="block text-xs font-medium text-secondary mb-1.5">
              Name
            </label>
            <input
              id="agent-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="backend, frontend, qa..."
              required
              autoFocus
              className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-sm text-default placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Model + Role row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="agent-model" className="block text-xs font-medium text-secondary mb-1.5">
                Model
              </label>
              <select
                id="agent-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-sm text-default focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="agent-role" className="block text-xs font-medium text-secondary mb-1.5">
                Role
              </label>
              <select
                id="agent-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-sm text-default focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mode */}
          <div>
            <label htmlFor="agent-mode" className="block text-xs font-medium text-secondary mb-1.5">
              Mode
            </label>
            <select
              id="agent-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-sm text-default focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Instructions */}
          <div>
            <label htmlFor="agent-instructions" className="block text-xs font-medium text-secondary mb-1.5">
              Instructions
              <span className="text-muted/50 ml-1 font-normal">optional</span>
            </label>
            <textarea
              id="agent-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Scope of responsibilities, tools to use, constraints..."
              rows={3}
              className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-sm text-default placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Tags
              <span className="text-muted/50 ml-1 font-normal">optional</span>
            </label>
            <div className="rounded-md border border-border-default bg-surface-sunken px-3 py-2">
              <TagInput tags={tags} onChange={setTags} placeholder="Add tag..." />
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-[11px] text-danger">{error.message}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-emphasis hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create agent"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm text-muted hover:text-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
