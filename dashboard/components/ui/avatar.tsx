import { cn } from "@/lib/utils"

const avatarColors = [
  "bg-accent-main-900/80",
  "bg-accent-pro-900",
  "bg-accent-secondary-900",
  "bg-success-900",
  "bg-warning-900",
] as const

const sizes = {
  sm: "h-5 w-5 text-[9px]",
  md: "h-6 w-6 text-[10px]",
  lg: "h-8 w-8 text-xs",
} as const

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

type AvatarProps = {
  name: string
  size?: keyof typeof sizes
  className?: string
}

function Avatar({ name, size = "md", className }: AvatarProps) {
  const colorIndex = hashName(name) % avatarColors.length
  const initial = name.charAt(0).toUpperCase()

  return (
    <span
      className={cn(
        "rounded-full inline-flex items-center justify-center font-medium text-oncolor-100",
        avatarColors[colorIndex],
        sizes[size],
        className,
      )}
    >
      {initial}
    </span>
  )
}

export { Avatar }
export type { AvatarProps }
