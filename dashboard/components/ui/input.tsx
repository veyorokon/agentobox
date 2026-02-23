import { forwardRef, type InputHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type InputProps = InputHTMLAttributes<HTMLInputElement>

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-border-default bg-surface-raised/60 px-3 py-2 text-sm text-default placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent-hover/50 focus:bg-surface-raised transition-colors",
          className,
        )}
        {...props}
      />
    )
  },
)

Input.displayName = "Input"

export { Input }
export type { InputProps }
