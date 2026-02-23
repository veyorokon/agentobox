"use client"

import { forwardRef, type ButtonHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

const variants = {
  primary: "bg-default text-surface hover:bg-default",
  secondary:
    "bg-transparent text-default border border-border-default/30 hover:bg-surface-backdrop",
  ghost: "bg-transparent text-secondary hover:bg-surface-sunken hover:text-default",
  danger: "bg-danger text-on-emphasis hover:bg-danger",
  accent: "bg-accent text-on-emphasis hover:bg-accent-hover",
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
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-(--duration-fast) active:scale-[0.985] disabled:opacity-50 disabled:pointer-events-none",
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
