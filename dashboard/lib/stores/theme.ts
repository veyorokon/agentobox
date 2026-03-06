import { create } from "zustand"
import { zustandLog } from "@/lib/stores/log-middleware"

/* ================================================================== */
/*  THEME STORE                                                         */
/*                                                                      */
/*  Owns the active theme config (theme name + color mode).             */
/*  Persists to localStorage and syncs data attributes on <html>.       */
/*                                                                      */
/*  Built-in themes: claude-dark, blyss-dark.                           */
/*  Theme files live in app/themes/<name>.css and use                    */
/*  [data-theme="<name>"][data-mode="<mode>"] selectors.                */
/* ================================================================== */

const STORAGE_KEY = "abox-theme"

const DEFAULT_CONFIG: ThemeConfig = { theme: "claude", mode: "dark" }

export type ThemeConfig = { theme: string; mode: string }

export interface ThemeState {
  config: ThemeConfig
  setTheme: (theme: string, mode?: string) => void
}

/** Available themes for the picker UI. */
export const BUILT_IN_THEMES: { id: string; label: string; mode: string }[] = [
  { id: "claude", label: "Claude Dark", mode: "dark" },
  { id: "blyss", label: "Blyss Dark", mode: "dark" },
]

function readPersistedConfig(): ThemeConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.theme === "string" && typeof parsed.mode === "string") {
        return parsed as ThemeConfig
      }
    }
  } catch {
    // intentional: corrupt localStorage — fall through to default
  }
  return DEFAULT_CONFIG
}

function persistConfig(config: ThemeConfig) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // intentional: localStorage full or unavailable — non-critical
  }
}

function applyToDocument(config: ThemeConfig) {
  if (typeof document === "undefined") return
  document.documentElement.setAttribute("data-theme", config.theme)
  document.documentElement.setAttribute("data-mode", config.mode)
}

export const useThemeStore = create<ThemeState>()(zustandLog("theme", (set) => ({
  config: readPersistedConfig(),

  setTheme: (theme, mode) => {
    const resolved: ThemeConfig = { theme, mode: mode ?? "dark" }
    persistConfig(resolved)
    applyToDocument(resolved)
    set({ config: resolved })
  },
})))
