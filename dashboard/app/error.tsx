"use client"

import { AlertCircle } from "lucide-react"

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-100">
      <div className="flex flex-col items-center gap-4">
        <AlertCircle className="h-10 w-10 text-danger-000" />
        <div className="flex flex-col items-center gap-1">
          <span className="text-text-200 text-sm font-medium">
            Something went wrong
          </span>
          <span className="text-text-500 text-xs max-w-xs text-center">
            {error.message || "An unexpected error occurred"}
          </span>
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
