"use client"

import { Bot, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"

type EmptyFeedProps = {
  hasAgents: boolean
}

export function EmptyFeed({ hasAgents }: EmptyFeedProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        {hasAgents ? (
          <MessageSquare className="h-8 w-8 text-text-500" />
        ) : (
          <Bot className="h-8 w-8 text-text-500" />
        )}
        <div className="flex flex-col items-center gap-1">
          <span className="text-text-300 text-sm">
            {hasAgents ? "No messages yet" : "No activity yet"}
          </span>
          <span className="text-text-500 text-xs">
            {hasAgents ? "Send a message to start" : "Create an agent to get started"}
          </span>
        </div>
      </div>
    </div>
  )
}
