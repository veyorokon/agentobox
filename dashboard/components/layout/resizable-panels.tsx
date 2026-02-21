"use client"

import { useState, useCallback, useRef, useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type ResizablePanelsProps = {
  left: ReactNode
  right: ReactNode
  defaultLeftWidth?: number
  minLeftWidth?: number
}

function ResizablePanels({
  left,
  right,
  defaultLeftWidth = 480,
  minLeftWidth = 320,
}: ResizablePanelsProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true
      startX.current = e.clientX
      startWidth.current = leftWidth
      e.preventDefault()
    },
    [leftWidth],
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - startX.current
      const newWidth = Math.max(minLeftWidth, startWidth.current + delta)
      setLeftWidth(newWidth)
    }

    const handleMouseUp = () => {
      isDragging.current = false
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [minLeftWidth])

  return (
    <div className="flex h-full">
      <div style={{ width: leftWidth }} className="shrink-0 overflow-hidden">
        {left}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleMouseDown}
        className={cn(
          "w-1 cursor-col-resize transition-colors shrink-0",
          "hover:bg-accent-main-000/30",
          isDragging.current && "bg-accent-main-000/30",
        )}
      />

      <div className="flex-1 overflow-hidden">{right}</div>
    </div>
  )
}

export { ResizablePanels }
export type { ResizablePanelsProps }
