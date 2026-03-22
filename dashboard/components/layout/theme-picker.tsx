"use client"

import { useState, useRef, useEffect } from "react"
import { Palette, Check } from "lucide-react"
import { useMutation } from "@apollo/client/react"
import { useParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/lib/stores/theme"
import { BUILT_IN_THEMES } from "@/lib/config"
import { SET_PROJECT_THEME } from "@/lib/graphql/mutations/projects"

export function ThemePicker({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const config = useThemeStore(s => s.config)
  const setTheme = useThemeStore(s => s.setTheme)
  const params = useParams()
  const projectId = params?.projectId as string | undefined
  const [setProjectTheme] = useMutation(SET_PROJECT_THEME)

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

  const handleThemeSelect = (themeId: string, mode: string) => {
    const selectedTheme = BUILT_IN_THEMES.find((theme) => theme.id === themeId && theme.mode === mode)
    if (!selectedTheme) return

    setTheme(themeId, mode)
    setOpen(false)

    // Persist the selected built-in theme by its canonical identity.
    // The backend owns resolving that selection into the actual token set.
    if (projectId) {
      setProjectTheme({ variables: { input: { projectId, theme: selectedTheme.id, mode: selectedTheme.mode } } }).catch(() => {
        // intentional: theme sync to backend is best-effort — local switch already applied
      })
    }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-raised/50 transition-colors shrink-0"
        title="Theme"
      >
        <Palette className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[140px] rounded-lg border border-border-default bg-surface-raised shadow-lg shadow-black/25 py-1">
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
  )
}
