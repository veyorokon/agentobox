"use client"

import { useState, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"

/** Drag handle for resizable panels. Supports mouse and touch. */
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

  const sign = side === "left" ? -1 : 1

  const startDrag = useCallback((clientX: number) => {
    lastX.current = clientX
    setActive(true)
    document.documentElement.classList.add("dragging-resize")
  }, [])

  const moveDrag = useCallback((clientX: number) => {
    const delta = clientX - lastX.current
    lastX.current = clientX
    onResize(sign * delta)
  }, [onResize, sign])

  const endDrag = useCallback(() => {
    setActive(false)
    document.documentElement.classList.remove("dragging-resize")
  }, [])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startDrag(e.clientX)
      const move = (ev: MouseEvent) => moveDrag(ev.clientX)
      const up = () => {
        endDrag()
        document.removeEventListener("mousemove", move)
        document.removeEventListener("mouseup", up)
      }
      document.addEventListener("mousemove", move)
      document.addEventListener("mouseup", up)
    },
    [startDrag, moveDrag, endDrag],
  )

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      startDrag(touch.clientX)
    },
    [startDrag],
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      e.preventDefault()
      moveDrag(touch.clientX)
    },
    [moveDrag],
  )

  const onTouchEnd = useCallback(() => {
    endDrag()
  }, [endDrag])

  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onDoubleClick={onReset}
      className={cn(
        "absolute top-0 bottom-0 w-4 z-(--z-dropdown) hover:cursor-col-resize touch-none",
        side === "left" ? "-left-2" : "-right-2",
      )}
    >
      <div className={cn(
        "absolute inset-y-0 w-0.5 transition-colors",
        active ? "bg-accent/50" : "bg-transparent",
        side === "left" ? "left-2" : "right-2",
      )} />
    </div>
  )
}
