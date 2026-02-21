"use client"

import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

type CollapsibleProps = {
  open: boolean
  children: ReactNode
  className?: string
}

function Collapsible({ open, children, className }: CollapsibleProps) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-out",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

export { Collapsible }
export type { CollapsibleProps }
