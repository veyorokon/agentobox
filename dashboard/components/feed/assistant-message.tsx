"use client"

import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { CopyButton } from "@/components/shared/copy-button"
import { ThinkingIndicator } from "@/components/feed/thinking-indicator"
import { stripSystemReminders } from "@/lib/utils"
import type { ContentBlock, AssistantEventData } from "@/types"

/**
 * Deterministic color based on agent name.
 * Returns a tailwind-compatible HSL string for the avatar background.
 */
const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-fuchsia-600",
  "bg-lime-600",
  "bg-orange-600",
  "bg-teal-600",
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

type AssistantMessageProps = {
  data: AssistantEventData
  agentName: string
  showAvatar?: boolean
}

export function AssistantMessage({ data, agentName, showAvatar = true }: AssistantMessageProps) {
  const content = data.message.content
  const blocks: ContentBlock[] = Array.isArray(content) ? content : []

  // Collect text blocks into a single markdown string, stripping system-reminder tags
  const textParts = blocks
    .filter((b) => b.type === "text" && "text" in b)
    .map((b) => stripSystemReminders((b as { type: "text"; text: string }).text))
    .filter((t) => t.trim().length > 0)

  const hasThinking = blocks.some(
    (b) => b.type === "thinking" || b.type === "redacted_thinking",
  )

  const avatarColor = getAvatarColor(agentName)
  const initial = agentName.charAt(0).toUpperCase()

  const fullText = textParts.join("\n\n")

  return (
    <div className="group/msg flex gap-2 min-w-0 relative">
      {/* Agent avatar — only shown for first message in a group */}
      {showAvatar ? (
        <div
          className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white mt-1 ${avatarColor}`}
        >
          {initial}
        </div>
      ) : (
        <div className="shrink-0 w-6" />
      )}

      <div className="min-w-0 flex-1">
        {/* Agent name — only shown with avatar */}
        {showAvatar && (
          <div className="text-[11px] text-muted font-mono mb-0.5">
            {agentName}
          </div>
        )}

        {/* Thinking indicator */}
        {hasThinking && !textParts.length && (
          <ThinkingIndicator label="Thinking..." />
        )}

        {/* Text content */}
        {textParts.length > 0 && (
          <MarkdownRenderer
            content={fullText}
            className="text-sm text-default"
          />
        )}
      </div>

      {/* Copy full message — appears on hover */}
      {fullText.length > 0 && (
        <div className="absolute top-0 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          <CopyButton text={fullText} />
        </div>
      )}
    </div>
  )
}
