"use client"

import { Bot, MessageSquare } from "lucide-react"

type EmptyFeedProps = {
  hasAgents: boolean
}

export function EmptyFeed({ hasAgents }: EmptyFeedProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        {hasAgents ? (
          <MessageSquare className="h-8 w-8 text-muted" />
        ) : (
          <Bot className="h-8 w-8 text-muted" />
        )}
        <div className="flex flex-col items-center gap-1">
          <span className="text-secondary text-sm">
            {hasAgents ? "No messages yet" : "No activity yet"}
          </span>
          <span className="text-muted text-xs">
            {hasAgents ? "Send a message to start" : "Create an agent to get started"}
          </span>
        </div>
      </div>
    </div>
  )
}
