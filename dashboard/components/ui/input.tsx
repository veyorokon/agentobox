import { forwardRef, type InputHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type InputProps = InputHTMLAttributes<HTMLInputElement>

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-border-300 bg-bg-000/60 px-3 py-2 text-sm text-text-100 placeholder:text-text-500 focus:outline-none focus:ring-1 focus:ring-accent-main-100/50 focus:bg-bg-000 transition-colors",
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
