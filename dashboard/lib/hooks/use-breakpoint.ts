"use client"

import { useMemo } from "react"
import type { Breakpoint } from "@/lib/types"
import { useWindowWidth } from "./use-window-width"

/* ================================================================== */
/*  BREAKPOINT HOOK                                                    */
/*                                                                     */
/*  Responsive breakpoint detection derived from useWindowWidth.       */
/*  Returns a semantic label instead of raw pixels.                    */
/* ================================================================== */

export function useBreakpoint(): Breakpoint {
  const w = useWindowWidth()

  return useMemo(() => {
    if (w < 1024) return "mobile"
    if (w < 1280) return "S"
    if (w < 1440) return "M"
    if (w < 1920) return "L"
    if (w < 2560) return "XL"
    return "2XL"
  }, [w])
}
