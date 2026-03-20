import { create } from "zustand"
import { zustandLog } from "@/lib/stores/log-middleware"
import {
  applyThemeConfigToDocument,
  DEFAULT_THEME,
  getBuiltInTheme,
  resolveThemeConfig,
  type ThemeConfig,
} from "@/lib/theme-registry"

/* ================================================================== */
/*  THEME STORE                                                         */
/*                                                                      */
/*  Owns the active theme config (theme name + color mode + tokens).    */
/*  Persists to localStorage and syncs data attributes on <html>.       */
/* ================================================================== */

const STORAGE_KEY = "abox-theme"

const DEFAULT_CONFIG: ThemeConfig = {
  theme: DEFAULT_THEME.id,
  mode: DEFAULT_THEME.mode,
  tokens: DEFAULT_THEME.tokens,
}

export interface ThemeState {
  config: ThemeConfig
  setTheme: (theme: string, mode?: string) => void
  syncTheme: (config: ThemeConfig) => void
}

function readPersistedConfig(): ThemeConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.theme === "string" && typeof parsed.mode === "string") {
        return resolveThemeConfig(parsed as ThemeConfig)
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
  applyThemeConfigToDocument(config)
}

export const useThemeStore = create<ThemeState>()(zustandLog("theme", (set) => ({
  config: readPersistedConfig(),

  setTheme: (theme, mode) => {
    const builtIn = getBuiltInTheme(theme, mode ?? "dark")
    const resolved: ThemeConfig = resolveThemeConfig({
      theme,
      mode: mode ?? "dark",
      tokens: builtIn?.tokens,
    })
    persistConfig(resolved)
    applyToDocument(resolved)
    set({ config: resolved })
  },

  syncTheme: (config) => {
    const resolved = resolveThemeConfig(config)
    persistConfig(resolved)
    applyToDocument(resolved)
    set({ config: resolved })
  },
})))
