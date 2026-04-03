export type ProjectPageErrorKind = "auth" | "forbidden" | "transient" | "generic"

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

export function classifyProjectPageError(error: unknown): ProjectPageErrorKind {
  const message = extractErrorMessage(error)
  const normalized = message.toLowerCase()

  if (
    normalized.includes("timed out")
    || normalized.includes("timeout")
    || normalized.includes("aborterror")
    || normalized.includes("failed to fetch")
    || normalized.includes("network request failed")
    || normalized.includes("backend unavailable")
  ) {
    return "transient"
  }

  if (isAuthGraphqlError(error)) {
    return "auth"
  }

  if (
    normalized.includes("project matching query does not exist")
    || normalized.includes("does not have access")
    || normalized.includes("forbidden")
    || normalized.includes("not owner")
    || normalized.includes("not found")
  ) {
    return "forbidden"
  }

  return "generic"
}

export function getProjectPageErrorPresentation(error: unknown): { title: string; detail: string } {
  const kind = classifyProjectPageError(error)
  const detail = describeGraphqlError(error)

  if (kind === "auth") {
    return {
      title: "Authentication required",
      detail,
    }
  }

  if (kind === "forbidden") {
    return {
      title: "You do not have access to this project",
      detail,
    }
  }

  if (kind === "transient") {
    return {
      title: "Project data is temporarily unavailable",
      detail,
    }
  }

  return {
    title: "Project data could not be loaded",
    detail,
  }
}

export function isAuthGraphqlError(error: unknown): boolean {
  const messages = extractErrorMessages(error)
  return messages.some((message) => {
    const normalized = message.toLowerCase()
    return (
      normalized.includes("authentication required")
      || normalized.includes("not authenticated")
      || normalized.includes("session expired")
      || normalized.includes("invalid token")
      || normalized.includes("bad token")
      || normalized.includes("401")
      || normalized.includes("403")
    )
  })
}

function extractErrorMessage(error: unknown): string {
  return extractErrorMessages(error)[0] ?? ""
}

function extractErrorMessages(error: unknown): string[] {
  if (!error) return []
  if (typeof error === "string") return [error]
  if (error instanceof Error) return [error.message]
  if (
    typeof error === "object"
    && error
    && "errors" in error
    && Array.isArray((error as { errors?: unknown[] }).errors)
  ) {
    const nested = (error as { errors: unknown[] }).errors
      .map((entry) => extractErrorMessage(entry))
      .filter(Boolean)
    if (nested.length) return nested
  }
  if (typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return [(error as { message: string }).message]
  }
  return []
}
