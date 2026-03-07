"use client"

import { useEffect, useState } from "react"
import { CheckCircle, XCircle, Info, AlertTriangle, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast, type ToastMessage } from "@/lib/toast"

const TOAST_ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
}

const TOAST_STYLES = {
  success: "bg-success/10 border-success/30 text-success",
  error: "bg-danger/10 border-danger/30 text-danger",
  info: "bg-accent/10 border-accent/30 text-accent",
  warning: "bg-warning/10 border-warning/30 text-warning",
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    return toast.subscribe(setToasts)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const Icon = TOAST_ICONS[t.type]
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto min-w-[280px] max-w-md rounded-lg border px-4 py-3 shadow-lg",
              "flex items-center gap-3 animate-toast-in",
              TOAST_STYLES[t.type],
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => toast.dismiss(t.id)}
              className="shrink-0 p-0.5 rounded hover:bg-surface-raised/30 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
