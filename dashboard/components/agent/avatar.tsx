"use client"

import { cn, agentHue } from "@/lib/utils"

export interface AgentAvatarProps {
  name: string
  size?: "sm" | "md" | "lg"
  stopped?: boolean
}

export function AgentAvatar({
  name,
  size = "md",
  stopped = false,
}: AgentAvatarProps) {
  const hue = agentHue(name)
  const dims = size === "sm" ? "h-5 w-5" : size === "lg" ? "h-8 w-8" : "h-6 w-6"
  const textSize = size === "sm" ? "text-[9px]" : size === "lg" ? "text-[12px]" : "text-[10px]"
  const radius = size === "sm" ? "rounded" : "rounded-md"

  return (
    <div
      className={cn(dims, radius, "flex items-center justify-center font-bold shrink-0", textSize)}
      style={{
        backgroundColor: `hsl(${hue} ${stopped ? "25%" : "40%"} ${stopped ? "18%" : "22%"})`,
        color: `hsl(${hue} ${stopped ? "30%" : "55%"} ${stopped ? "45%" : "68%"})`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

export interface ChatAvatarProps {
  name: string
}

/** Round avatar for chat feed (matches assistant-message style) */
export function ChatAvatar({ name }: ChatAvatarProps) {
  const hue = agentHue(name)
  return (
    <div
      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-on-emphasis mt-1"
      style={{
        backgroundColor: `hsl(${hue} var(--color-avatar-saturation) var(--color-avatar-lightness))`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}
