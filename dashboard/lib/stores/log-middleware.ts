import type { StateCreator } from "zustand"
import { createLogger } from "@/lib/logger"

/* ================================================================== */
/*  ZUSTAND LOGGING MIDDLEWARE                                          */
/*                                                                      */
/*  Wraps any zustand store to log state diffs on every `set()` call.  */
/*  Uses the unified logger — same gate, same sinks, same LogEntry.    */
/*                                                                      */
/*  Usage:                                                              */
/*    create<T>()(zustandLog("storeName", (set) => ({ ... })))         */
/* ================================================================== */

const log = createLogger("zustand")

/**
 * Compute a shallow diff between prev and next state.
 * Only includes keys whose values actually changed (by reference).
 */
function shallowDiff(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of Object.keys(next)) {
    if (prev[key] !== next[key]) {
      diff[key] = { from: prev[key], to: next[key] }
    }
  }
  return diff
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zustandLog<T>(storeName: string, initializer: StateCreator<T, any, any>): StateCreator<T, any, any> {
  return (set, get, api) => {
    // Zustand's set() has overloaded signatures that are impossible to type
    // through a generic wrapper. Cast is safe — we forward all args unchanged.
    const loggedSet = ((...args: unknown[]) => {
      const prev = get() as Record<string, unknown>
      ;(set as (...a: unknown[]) => void)(...args)
      const next = get() as Record<string, unknown>
      const diff = shallowDiff(prev, next)
      if (Object.keys(diff).length > 0) {
        log(`${storeName}.set`, { changed: Object.keys(diff), diff })
      }
    }) as typeof set
    return initializer(loggedSet, get, api)
  }
}
