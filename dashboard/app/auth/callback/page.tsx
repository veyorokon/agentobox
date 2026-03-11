"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getBackendUrl } from "@/lib/utils"

export default function AuthCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function exchangeSession() {
      try {
        const backendUrl = getBackendUrl()
        const res = await fetch(
          `${backendUrl}/_allauth/browser/v1/auth/session`,
          { credentials: "include" },
        )

        if (!res.ok) {
          if (!cancelled) setError("Failed to verify session")
          return
        }

        const json = await res.json()

        const token =
          json?.meta?.access_token ??
          json?.meta?.session_token ??
          json?.data?.meta?.access_token ??
          json?.data?.meta?.session_token ??
          null

        if (!token) {
          if (!cancelled) setError("No session token returned")
          return
        }

        localStorage.setItem("auth_token", token)
        if (!cancelled) router.replace("/")
      } catch {
        if (!cancelled) setError("Something went wrong — please try again")
      }
    }

    exchangeSession()
    return () => { cancelled = true }
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface dotted-grid">
        <div
          className="pointer-events-none fixed inset-0"
          style={{
            background: "radial-gradient(ellipse 80% 60% at 50% 120%, var(--color-danger-subtle) 0%, transparent 70%)",
          }}
        />
        <div className="relative w-full max-w-[360px] px-6 text-center">
          <div className="w-10 h-10 rounded-xl bg-danger/15 flex items-center justify-center mb-5 mx-auto">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-danger">
              <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-default mb-2">
            Agentobox
          </h1>
          <div className="mb-5 rounded-lg border border-danger/20 bg-danger/5 px-3.5 py-2.5">
            <p className="text-[13px] text-danger leading-snug">{error}</p>
          </div>
          <a
            href="/login"
            className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:text-accent-hover transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to sign in
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dotted-grid">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 120%, var(--color-accent-subtle) 0%, transparent 70%)",
        }}
      />
      <div className="relative text-center">
        <div className="w-10 h-10 rounded-xl bg-accent/90 flex items-center justify-center mb-5 mx-auto shadow-md">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-on-emphasis animate-spin" style={{ animationDuration: "1.2s" }}>
            <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.9" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.6" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.6" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.35" />
          </svg>
        </div>
        <p className="text-[13px] text-muted tracking-wide">Completing sign-in...</p>
      </div>
    </div>
  )
}
