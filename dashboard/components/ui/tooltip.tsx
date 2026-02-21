"use client"

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

const positions = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
} as const

type TooltipProps = {
  content: string
  children: ReactNode
  side?: keyof typeof positions
  className?: string
}

function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [visible, setVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      <span
        className={cn(
          "absolute z-50 bg-bg-300 text-text-100 text-xs rounded-md px-2.5 py-1.5 shadow-lg whitespace-nowrap pointer-events-none transition-all duration-150",
          positions[side],
          visible
            ? "opacity-100 scale-100"
            : "opacity-0 scale-95",
          className,
        )}
      >
        {content}
      </span>
    </span>
  )
}

export { Tooltip }
export type { TooltipProps }
