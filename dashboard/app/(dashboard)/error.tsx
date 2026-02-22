"use client"

import { AlertCircle } from "lucide-react"

const isDev = process.env.NODE_ENV === "development"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <AlertCircle className="h-10 w-10 text-danger-000" />
        <div className="flex flex-col items-center gap-1">
          <span className="text-text-200 text-sm font-medium">
            Something went wrong
          </span>
          {isDev ? (
            <span className="text-text-500 text-xs max-w-xs text-center font-mono">
              {error.message}
            </span>
          ) : (
            <span className="text-text-500 text-xs max-w-xs text-center">
              Try refreshing the page.{error.digest && ` (ref: ${error.digest})`}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={reset}
          className="px-4 py-1.5 text-sm rounded-md bg-bg-000 text-text-200 hover:text-text-100 border border-border-300 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
