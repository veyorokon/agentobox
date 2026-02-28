import { useEffect, type RefObject } from "react"

/** Close dropdowns/popovers when clicking outside the ref element. */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onClickOutside: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClickOutside()
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [ref, onClickOutside, enabled])
}
