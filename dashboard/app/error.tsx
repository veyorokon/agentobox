"use client"

import { AlertCircle } from "lucide-react"

const isDev = process.env.NODE_ENV === "development"

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-4">
        <AlertCircle className="h-10 w-10 text-danger" />
        <div className="flex flex-col items-center gap-1">
          <span className="text-secondary text-sm font-medium">
            Something went wrong
          </span>
          {isDev ? (
            <span className="text-muted text-xs max-w-xs text-center font-mono">
              {error.message}
            </span>
          ) : (
            <span className="text-muted text-xs max-w-xs text-center">
              Try refreshing the page.{error.digest && ` (ref: ${error.digest})`}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={reset}
          className="px-4 py-1.5 text-sm rounded-md bg-surface-raised text-secondary hover:text-default border border-border-default transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
