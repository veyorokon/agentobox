"use client"

import { forwardRef, type ButtonHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

const variants = {
  primary: "bg-text-000 text-bg-000 hover:bg-text-100",
  secondary:
    "bg-transparent text-text-000 border border-border-200/30 hover:bg-bg-400",
  ghost: "bg-transparent text-text-300 hover:bg-bg-300 hover:text-text-100",
  danger: "bg-danger-200 text-oncolor-100 hover:bg-danger-100",
  accent: "bg-accent-main-000 text-oncolor-100 hover:bg-accent-main-200",
} as const

const sizes = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
  lg: "h-11 px-5 text-base",
} as const

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-100 active:scale-[0.985] disabled:opacity-50 disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    )
  },
)

Button.displayName = "Button"

export { Button }
export type { ButtonProps }
