import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

type KbdProps = {
  children: ReactNode
  className?: string
}

function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center bg-bg-200 border border-border-300 rounded px-1.5 py-0.5 text-[10px] font-mono text-text-300 min-w-[20px]",
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export { Kbd }
export type { KbdProps }
