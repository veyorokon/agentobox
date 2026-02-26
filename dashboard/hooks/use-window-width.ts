"use client"

import { useState, useEffect } from "react"

/* ================================================================== */
/*  WINDOW WIDTH HOOK                                                   */
/*                                                                      */
/*  Returns the current window.innerWidth, updated on resize with       */
/*  RAF debouncing. Unlike useBreakpoint, this returns the raw pixel    */
/*  value so derived metrics (collapse threshold, min panel width)      */
/*  stay accurate between breakpoint boundaries.                        */
/* ================================================================== */

export function useWindowWidth(fallback = 1920): number {
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    setWidth(window.innerWidth)
    let raf: number
    function onResize() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return width
}
