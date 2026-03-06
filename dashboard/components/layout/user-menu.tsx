"use client"

import { useState, useRef, useEffect, type ReactNode } from "react"
import { LogOut, FolderOpen, Palette, Check } from "lucide-react"
import { useMutation } from "@apollo/client"
import { useParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { useThemeStore, BUILT_IN_THEMES } from "@/lib/stores/theme"
import { SET_PROJECT_THEME } from "@/lib/graphql/mutations/projects"

interface UserMenuProps {
  children: ReactNode
  className?: string
}

export function UserMenu({ children, className }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { config, setTheme } = useThemeStore()
  const params = useParams()
  const projectId = params?.projectId as string | undefined
  const [setProjectTheme] = useMutation(SET_PROJECT_THEME)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setThemeOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const handleThemeSelect = (themeId: string, mode: string) => {
    setTheme(themeId, mode)
    setThemeOpen(false)
    setOpen(false)

    // Fire-and-forget mutation to sync with backend (pushes to agents)
    if (projectId) {
      // Build a minimal token map from CSS custom properties for agent theming.
      // The backend pushes these to agents for AwesomeWM/Firefox theme sync.
      const style = getComputedStyle(document.documentElement)
      const tokenKeys = [
        "surface", "surface-raised", "surface-sunken", "surface-overlay",
        "accent", "text-default", "text-muted", "danger", "success", "warning",
      ]
      const tokens: Record<string, string> = {}
      for (const key of tokenKeys) {
        const val = style.getPropertyValue(`--p-${key}`).trim()
        if (val) tokens[key] = val
      }
      if (Object.keys(tokens).length > 0) {
        setProjectTheme({ variables: { input: { projectId, tokens } } }).catch(() => {
          // intentional: theme sync to backend is best-effort — local switch already applied
        })
      }
    }
  }

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
          {/* Theme picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setThemeOpen(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-secondary hover:text-default hover:bg-surface-sunken/50 transition-colors"
            >
              <Palette className="h-3 w-3 opacity-60" />
              Theme
            </button>
            {themeOpen && (
              <div className="absolute left-full top-0 ml-1 min-w-[140px] rounded-lg border border-border-default bg-surface-raised shadow-lg shadow-black/25 py-1">
                {BUILT_IN_THEMES.map((t) => (
                  <button
                    key={`${t.id}-${t.mode}`}
                    type="button"
                    onClick={() => handleThemeSelect(t.id, t.mode)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-secondary hover:text-default hover:bg-surface-sunken/50 transition-colors"
                  >
                    {config.theme === t.id && config.mode === t.mode ? (
                      <Check className="h-3 w-3 text-accent" />
                    ) : (
                      <span className="h-3 w-3" />
                    )}
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="my-0.5 mx-2 border-t border-border-subtle" />
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem("auth_token")
              window.location.href = "/login"
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
