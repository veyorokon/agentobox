/* ================================================================== */
/*  Token lifecycle — single source of truth for auth state            */
/*                                                                     */
/*  Every read, write, and clear goes through here. This makes it      */
/*  trivial to trace logout triggers and prevents scattered callers    */
/*  from racing each other.                                            */
/* ================================================================== */

import { createLogger } from "@/lib/logger"

const log = createLogger("auth")
const TOKEN_KEY = "auth_token"

let redirecting = false

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  log("token.set")
}

/**
 * Clear the token and redirect to /login.
 *
 * Guarded: if multiple callers race (e.g. WS close + Apollo error link),
 * only the first one executes. The guard resets on the next page load
 * (redirect clears JS state).
 */
export function clearTokenAndRedirect(reason: string): void {
  if (redirecting) {
    log("token.clear_skipped", { reason, note: "redirect already in progress" })
    return
  }
  redirecting = true

  // Persist breadcrumb — survives the redirect that clears console + JS state.
  // Read on login page: sessionStorage.getItem("auth_logout_reason")
  const entry = `${new Date().toISOString()} | ${reason} | ${window?.location?.pathname ?? "?"}`
  try {
    const prev = sessionStorage.getItem("auth_logout_log") ?? ""
    sessionStorage.setItem("auth_logout_log", (prev ? prev + "\n" : "") + entry)
  } catch { /* SSR or private browsing */ }

  // console.warn survives even without "preserve log" in some browsers
  console.warn(`[auth] token.clear | reason=${reason} | path=${window?.location?.pathname}`)
  log("token.clear", { reason })

  localStorage.removeItem(TOKEN_KEY)
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login"
  }
}

/** Authorization header value for HTTP requests. */
export function getAuthHeader(): string {
  const token = getToken()
  return token ? `Bearer ${token}` : ""
}

/**
 * Storage event watchdog — detects if auth_token is removed by another tab
 * or by code that bypasses this module. Call once at app root.
 */
export function watchTokenRemoval(): () => void {
  if (typeof window === "undefined") return () => {}

  const handler = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY && e.newValue === null && e.oldValue !== null) {
      console.warn("[auth] token removed externally (storage event)")
      try {
        const entry = `${new Date().toISOString()} | EXTERNAL_STORAGE_EVENT | ${window.location.pathname}`
        const prev = sessionStorage.getItem("auth_logout_log") ?? ""
        sessionStorage.setItem("auth_logout_log", (prev ? prev + "\n" : "") + entry)
      } catch { /* ignore */ }
    }
  }
  window.addEventListener("storage", handler)
  return () => window.removeEventListener("storage", handler)
}
