"use client"

import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { CopyButton } from "@/components/shared/copy-button"
import { ChatAvatar } from "@/components/agent/avatar"

export interface AssistantMessageProps {
  agent: string
  content: string
  showAvatar?: boolean
}

/** Assistant message with markdown -- left-aligned with avatar (used in agent detail feed) */
export function AssistantMessage({
  agent,
  content,
  showAvatar = true,
}: AssistantMessageProps) {
  return (
    <div className="group/msg flex gap-2 min-w-0">
      {showAvatar ? (
        <ChatAvatar name={agent} />
      ) : (
        <div className="shrink-0 w-6" />
      )}
      <div className="min-w-0 flex-1">
        {showAvatar && (
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[11px] text-muted font-mono">{agent}</span>
            {content.length > 0 && (
              <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity">
                <CopyButton text={content} />
              </div>
            )}
          </div>
        )}
        <MarkdownRenderer
          content={content}
          className="text-sm text-default"
        />
      </div>
    </div>
  )
}
