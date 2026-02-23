"use client"

import { useState, useContext } from "react"
import { cn } from "@/lib/utils"
import { Collapsible } from "@/components/ui/collapsible"
import { ChevronRight } from "lucide-react"
import { FeedScrollContext } from "@/components/feed/feed-container"
import { StatusMessage } from "@/components/feed/status-message"
import { SystemMessage } from "@/components/feed/system-message"
import type { TimelineEntry, StatusEventData, SystemEventData } from "@/types"

type StatusGroupRowProps = {
  items: TimelineEntry[]
}

function renderStatusItem(item: TimelineEntry) {
  if (item.entryType === "status") {
    return <StatusMessage data={item.data as StatusEventData} agentName={item.agentName} />
  }
  if (item.entryType === "system") {
    return <SystemMessage data={item.data as SystemEventData} />
  }
  return null
}

export function StatusGroupRow({ items }: StatusGroupRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { isAtBottom, scrollAfterExpand } = useContext(FeedScrollContext)

  if (items.length === 0) return null

  return (
    <div className="px-4 py-0.5">
      <button
        type="button"
        onClick={() => {
          const wasAtBottom = isAtBottom()
          const willExpand = !expanded
          setExpanded(willExpand)
          if (willExpand && wasAtBottom) scrollAfterExpand()
        }}
        className="flex items-center justify-center gap-1.5 w-full cursor-pointer py-px"
      >
        <ChevronRight
          size={10}
          className={cn(
            "shrink-0 text-muted/60 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <span className="text-muted/60 text-[10px] font-mono">
          {items.length} events
        </span>
      </button>

      <Collapsible open={expanded}>
        <div className="space-y-px">
          {items.map((item) => (
            <div key={item.id}>{renderStatusItem(item)}</div>
          ))}
        </div>
      </Collapsible>
    </div>
  )
}
