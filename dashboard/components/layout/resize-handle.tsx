"use client"

import { useState, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"

/** Drag handle for resizable panels. Place on the leading edge of the panel. */
export function ResizeHandle({
  onResize,
  onReset,
  side = "left",
}: {
  onResize: (delta: number) => void
  onReset?: () => void
  side?: "left" | "right"
}) {
  const lastX = useRef(0)
  const [active, setActive] = useState(false)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      lastX.current = e.clientX
      setActive(true)
      document.documentElement.classList.add("dragging-resize")
      const move = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX.current
        lastX.current = ev.clientX
        onResize(side === "left" ? -delta : delta)
      }
      const up = () => {
        setActive(false)
        document.documentElement.classList.remove("dragging-resize")
        document.removeEventListener("mousemove", move)
        document.removeEventListener("mouseup", up)
      }
      document.addEventListener("mousemove", move)
      document.addEventListener("mouseup", up)
    },
    [onResize, side],
  )

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      className={cn(
        "absolute top-0 bottom-0 w-3 z-(--z-dropdown) hover:cursor-col-resize",
        side === "left" ? "-left-1.5" : "-right-1.5",
      )}
    >
      <div className={cn(
        "absolute inset-y-0 w-0.5 transition-colors",
        active ? "bg-accent/50" : "bg-transparent",
        side === "left" ? "left-1.5" : "right-1.5",
      )} />
    </div>
  )
}
