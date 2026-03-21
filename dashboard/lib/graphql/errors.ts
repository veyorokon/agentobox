export function describeGraphqlError(error: unknown): string {
  const message = extractErrorMessage(error)
  const normalized = message.toLowerCase()

  if (
    normalized.includes("timed out")
    || normalized.includes("timeout")
    || normalized.includes("aborterror")
    || normalized.includes("failed to fetch")
    || normalized.includes("network request failed")
  ) {
    return "Backend timed out. Retry in a moment."
  }

  if (normalized.includes("401") || normalized.includes("403")) {
    return "Session expired. Sign in again."
  }

  return message || "Backend unavailable. Retry in a moment."
}

function extractErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message
  }
  return ""
}
