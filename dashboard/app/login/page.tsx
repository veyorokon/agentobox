"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { getToken } from "@/lib/auth"

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled",
  failed: "Authentication failed — please try again",
  no_session: "Could not establish a session — please try again",
}

export default function LoginPage() {
  const searchParams = useSearchParams()
  const errorCode = searchParams.get("error")
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] ?? errorCode : null

  const [redirecting, setRedirecting] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (getToken()) {
      window.location.href = "/"
      return
    }

    // Dump auth breadcrumbs from previous session — survives the redirect
    try {
      const logoutLog = sessionStorage.getItem("auth_logout_log")
      if (logoutLog) {
        console.warn("[auth] logout breadcrumbs from previous session:\n" + logoutLog)
      } else {
        console.warn("[auth] no logout breadcrumbs — token may have been cleared outside lib/auth.ts")
      }
    } catch { /* private browsing */ }

    // Stagger the mount animation
    const t = setTimeout(() => setMounted(true), 50)

    // Reset loading state on back-navigation (bfcache restore)
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setRedirecting(null)
    }
    window.addEventListener("pageshow", onPageShow)
    return () => {
      clearTimeout(t)
      window.removeEventListener("pageshow", onPageShow)
    }
  }, [])

  const handleProvider = useCallback(async (provider: "google" | "github") => {
    setRedirecting(provider)
    try {
      // Fetch config to get CSRF cookie — same-origin via Next.js rewrite
      await fetch("/_allauth/browser/v1/config", {
        credentials: "include",
      })

      const csrfToken = document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrftoken="))
        ?.split("=")[1] ?? ""

      const form = formRef.current
      if (!form) return

      // POST through same-origin rewrite — no cross-origin cookie issues
      form.action = "/_allauth/browser/v1/auth/provider/redirect"
      form.method = "POST"
      form.innerHTML = ""

      const addField = (name: string, value: string) => {
        const input = document.createElement("input")
        input.type = "hidden"
        input.name = name
        input.value = value
        form.appendChild(input)
      }

      const callbackUrl = `${window.location.origin}/auth/callback`
      addField("provider", provider)
      addField("callback_url", callbackUrl)
      addField("csrfmiddlewaretoken", csrfToken)
      addField("process", "login")

      form.submit()
    } catch {
      setRedirecting(null)
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dotted-grid overflow-hidden">
      {/* Atmospheric gradient overlay */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 120%, var(--color-accent-subtle) 0%, transparent 70%)",
        }}
      />

      <div
        className="relative w-full max-w-[360px] px-6"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Logo mark */}
        <div className="flex flex-col items-center mb-10">
          <div
            className="w-10 h-10 rounded-xl bg-accent/90 flex items-center justify-center mb-5 shadow-md"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? "scale(1)" : "scale(0.8)",
              transition: "opacity 0.4s ease 0.1s, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-on-emphasis">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.9" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.6" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.6" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.35" />
            </svg>
          </div>
          <h1
            className="text-[22px] font-semibold tracking-tight text-default"
            style={{
              opacity: mounted ? 1 : 0,
              transition: "opacity 0.4s ease 0.2s",
            }}
          >
            Agentobox
          </h1>
          <p
            className="text-[13px] text-muted mt-1.5 tracking-wide"
            style={{
              opacity: mounted ? 0.8 : 0,
              transition: "opacity 0.4s ease 0.25s",
            }}
          >
            Sign in to your workspace
          </p>
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div className="mb-5 rounded-lg border border-danger/20 bg-danger/5 px-3.5 py-2.5 backdrop-blur-sm">
            <p className="text-[13px] text-danger leading-snug">{errorMessage}</p>
          </div>
        )}

        {/* Auth buttons */}
        <div
          className="space-y-2.5"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(6px)",
            transition: "opacity 0.4s ease 0.3s, transform 0.4s ease 0.3s",
          }}
        >
          <button
            type="button"
            disabled={redirecting !== null}
            onClick={() => handleProvider("google")}
            className="group w-full flex items-center justify-center gap-2.5 rounded-lg border border-border-default bg-surface-raised px-4 py-2.5 text-[13.5px] font-medium text-default transition-all duration-150 hover:border-border-strong hover:bg-surface-overlay hover:shadow-sm active:scale-[0.985] disabled:opacity-40 disabled:pointer-events-none"
          >
            {redirecting === "google" ? (
              <Spinner />
            ) : (
              <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            )}
            Continue with Google
          </button>

          <button
            type="button"
            disabled={redirecting !== null}
            onClick={() => handleProvider("github")}
            className="group w-full flex items-center justify-center gap-2.5 rounded-lg border border-border-default bg-surface-raised px-4 py-2.5 text-[13.5px] font-medium text-default transition-all duration-150 hover:border-border-strong hover:bg-surface-overlay hover:shadow-sm active:scale-[0.985] disabled:opacity-40 disabled:pointer-events-none"
          >
            {redirecting === "github" ? (
              <Spinner />
            ) : (
              <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            )}
            Continue with GitHub
          </button>
        </div>

        {/* Footer */}
        <p
          className="text-center text-[11px] text-muted mt-8 tracking-wide"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.5s ease 0.5s",
          }}
        >
          By continuing, you agree to our{" "}
          <a href="/terms" className="text-text-link hover:text-text-link-hover hover:underline transition-colors">
            terms of service
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-text-link hover:text-text-link-hover hover:underline transition-colors">
            privacy policy
          </a>
        </p>

        <form ref={formRef} style={{ display: "none" }} />
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-muted/20 border-t-muted animate-spin" />
  )
}
