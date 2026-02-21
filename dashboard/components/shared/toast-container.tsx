"use client"

import { useEffect, useRef } from "react"
import { Check, AlertCircle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUIStore, type Toast } from "@/stores/ui"

const ICON_MAP = {
  success: Check,
  error: AlertCircle,
  info: Info,
} as const

const BORDER_MAP = {
  success: "border-l-2 border-l-success-000",
  error: "border-l-2 border-l-danger-000",
  info: "border-l-2 border-l-accent-secondary-000",
} as const

const ICON_COLOR_MAP = {
  success: "text-success-000",
  error: "text-danger-000",
  info: "text-accent-secondary-000",
} as const

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useUIStore((s) => s.removeToast)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const duration = toast.duration ?? 4000
    timerRef.current = setTimeout(() => {
      removeToast(toast.id)
    }, duration)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast.id, toast.duration, removeToast])

  const Icon = ICON_MAP[toast.type]

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-md bg-bg-000 px-3 py-2.5 shadow-lg",
        "animate-toast-in",
        BORDER_MAP[toast.type],
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", ICON_COLOR_MAP[toast.type])} />
      <span className="text-sm text-text-100 flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => removeToast(toast.id)}
        className="p-0.5 text-text-400 hover:text-text-200 rounded transition-colors shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
