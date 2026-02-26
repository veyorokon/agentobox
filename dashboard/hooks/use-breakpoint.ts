"use client"

import { useState, useEffect } from "react"
import type { Breakpoint } from "@/lib/types"

/* ================================================================== */
/*  BREAKPOINT HOOK                                                    */
/*                                                                     */
/*  Responsive breakpoint detection with RAF-debounced resize.         */
/*  Returns a semantic label instead of raw pixels.                    */
/* ================================================================== */

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("XL")

  useEffect(() => {
    function calc() {
      const w = window.innerWidth
      if (w < 1024) setBp("mobile")
      else if (w < 1280) setBp("S")
      else if (w < 1440) setBp("M")
      else if (w < 1920) setBp("L")
      else setBp("XL")
    }
    calc()
    let raf: number
    function onResize() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(calc)
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return bp
}
