"use client"

import { useState, useRef, useEffect, type ReactNode } from "react"
import { LogOut, FolderOpen } from "lucide-react"
import { cn, getBackendUrl } from "@/lib/utils"
import { clearTokenAndRedirect } from "@/lib/auth"

interface UserMenuProps {
  children: ReactNode
  className?: string
}

export function UserMenu({ children, className }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  return (
    <div ref={ref} className={cn("relative", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(v => !v) }}
      >
        {children}
      </div>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[148px] rounded-lg border border-border-default bg-surface-raised shadow-lg shadow-black/25 py-1">
          <a
            href="/"
            className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-secondary hover:text-default hover:bg-surface-sunken/50 transition-colors"
          >
            <FolderOpen className="h-3 w-3 opacity-60" />
            Projects
          </a>
          <div className="my-0.5 mx-2 border-t border-border-subtle" />
          <button
            type="button"
            onClick={() => {
              // Clear server session (fire-and-forget), then clear local token
              const backendUrl = getBackendUrl()
              fetch(`${backendUrl}/_allauth/browser/v1/auth/session`, {
                method: "DELETE",
                credentials: "include",
              }).catch(() => {})
              clearTokenAndRedirect("user_signout")
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-secondary hover:text-danger hover:bg-danger/5 transition-colors"
          >
            <LogOut className="h-3 w-3 opacity-60" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
