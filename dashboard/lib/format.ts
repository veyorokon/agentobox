/**
 * Format a raw model identifier into a compact display name.
 *
 * Examples:
 *   "claude-opus-4-6"   → "Opus 4.6"
 *   "claude-sonnet-4-6" → "Sonnet 4.6"
 *   "claude-haiku-4-5"  → "Haiku 4.5"
 *   "gpt-4o"            → "gpt-4o"  (pass-through for non-Claude models)
 */
export function formatModelName(model: string): string {
  if (!model) return ""

  // Match claude-{family}-{major}-{minor} with optional trailing segments
  const match = model.match(/^claude-(\w+)-(\d+)-(\d+)/)
  if (match) {
    const [, family, major, minor] = match
    const name = family.charAt(0).toUpperCase() + family.slice(1)
    return `${name} ${major}.${minor}`
  }

  // Fallback: return as-is for unknown formats
  return model
}
