"use client"

import { useState, useEffect, useCallback } from "react"
import { useMutation } from "@apollo/client/react"
import { X } from "lucide-react"
import { CAPTURE_INCIDENT } from "@/lib/graphql/mutations/incidents"
import { toast } from "@/lib/toast"

interface IncidentModalProps {
  open: boolean
  onClose: () => void
  agentId: string
  agentName: string
}

export function IncidentModal({ open, onClose, agentId, agentName }: IncidentModalProps) {
  const [note, setNote] = useState("")
  const [captureIncident, { loading }] = useMutation<{
    captureIncident: { incidentId: string; createdAt: string }
  }>(CAPTURE_INCIDENT)

  useEffect(() => {
    if (open) {
      setNote("")
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  const handleSubmit = useCallback(async () => {
    try {
      const { data } = await captureIncident({
        variables: {
          input: {
            agentId,
            note: note.trim(),
            windowMinutes: 30,
          },
        },
      })
      const incidentId = data?.captureIncident?.incidentId
      if (incidentId) {
        const copied = await navigator.clipboard.writeText(incidentId).then(() => true, () => false)
        toast.success(
          copied
            ? `Incident ${incidentId.slice(0, 8)} captured — ID copied`
            : `Incident captured: ${incidentId.slice(0, 8)}`
        )
      }
      onClose()
    } catch (err: any) {
      toast.error(err.message || "Failed to capture incident")
    }
  }, [agentId, note, captureIncident, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-(--z-overlay) bg-black/50 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface border border-border-default rounded-xl shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="h-10 px-4 flex items-center justify-between border-b border-border-default">
          <h2 className="text-sm font-medium">Report Incident</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted hover:text-secondary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-muted">
            Capture a diagnosis snapshot for <span className="text-default font-medium">@{agentName}</span>.
            Recent events, logs, and state will be bundled automatically.
          </p>

          <div>
            <label className="block text-[11px] text-secondary mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened? What were you doing?"
              rows={3}
              className="w-full rounded-md border border-border-default bg-surface-sunken px-3 py-2 text-xs text-default placeholder:text-muted/40 focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-muted hover:text-secondary rounded-md border border-border-default hover:bg-surface-raised transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="px-3 py-1.5 text-xs text-white bg-accent hover:bg-accent/90 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Capturing..." : "Capture"}
          </button>
        </div>
      </div>
    </div>
  )
}
