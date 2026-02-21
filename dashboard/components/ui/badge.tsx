import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

const variants = {
  default: "bg-bg-300 text-text-200",
  success: "bg-success-900 text-success-000",
  warning: "bg-warning-900 text-warning-000",
  danger: "bg-danger-900 text-danger-000",
  info: "bg-accent-secondary-900 text-accent-secondary-000",
} as const

type BadgeProps = {
  variant?: keyof typeof variants
  children: ReactNode
  className?: string
}

function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

export { Badge }
export type { BadgeProps }
