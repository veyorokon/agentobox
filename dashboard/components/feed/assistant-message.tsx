"use client"

import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { CopyButton } from "@/components/shared/copy-button"
import { AgentTag } from "@/components/agent/avatar"

export interface AssistantMessageProps {
  agent: string
  content: string
  showAvatar?: boolean
}

/** Assistant message with markdown -- left-aligned with @agent tag */
export function AssistantMessage({
  agent,
  content,
  showAvatar = true,
}: AssistantMessageProps) {
  return (
    <div className="group/msg relative min-w-0">
      {showAvatar && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <AgentTag name={agent} />
        </div>
      )}
      <MarkdownRenderer
        content={content}
        className="text-sm text-default"
      />
      {content.length > 0 && (
        <div className="absolute top-0 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          <CopyButton text={content} />
        </div>
      )}
    </div>
  )
}
