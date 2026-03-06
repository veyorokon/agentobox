"use client"

import { useEffect } from "react"
import { useThemeStore } from "@/lib/stores/theme"

/**
 * ThemeProvider — syncs zustand theme state to <html> data attributes.
 *
 * On mount: reads the persisted config from the store (which reads
 * localStorage) and applies data-theme + data-mode to the document.
 * Subscribes to store changes to keep attributes in sync.
 *
 * The inline script in layout.tsx handles the initial flash-prevention
 * (sets attributes before React hydrates). This component takes over
 * once the app is interactive.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const config = useThemeStore((s) => s.config)

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", config.theme)
    document.documentElement.setAttribute("data-mode", config.mode)
  }, [config.theme, config.mode])

  return <>{children}</>
}
