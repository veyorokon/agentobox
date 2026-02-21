"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"
import type { FeedItem } from "@/types"

type ThinkingMessageProps = {
  item: FeedItem
}

export function ThinkingMessage({ item }: ThinkingMessageProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 text-text-400 text-sm italic cursor-pointer hover:text-text-200 transition-colors"
      >
        <ChevronRight
          size={14}
          className={cn(
            "transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        Thinking...
      </button>

      {expanded && item.text && (
        <div className="text-text-300 text-sm italic bg-bg-300/50 rounded-lg p-3 mt-1">
          {item.text}
        </div>
      )}
    </div>
  )
}
