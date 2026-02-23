"use client"

import { MessageSquare } from "lucide-react"
import { cn, formatTime } from "@/lib/utils"
import type { Project } from "@/types"

type SidebarItemProps = {
  project: Project
  isActive: boolean
  onClick: () => void
}

function SidebarItem({ project, isActive, onClick }: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2 mx-1.5 rounded-lg cursor-pointer transition-colors text-left w-[calc(100%-0.75rem)]",
        isActive && "bg-surface-raised/80",
        !isActive && "hover:bg-surface-raised/30",
      )}
    >
      <MessageSquare className="h-3.5 w-3.5 text-muted shrink-0" />
      <span
        className={cn(
          "text-sm text-secondary truncate flex-1",
          isActive && "text-default",
        )}
      >
        {project.name}
      </span>
      <span className="text-[11px] text-muted shrink-0">
        {formatTime(project.createdAt)}
      </span>
    </button>
  )
}

export { SidebarItem }
export type { SidebarItemProps }
