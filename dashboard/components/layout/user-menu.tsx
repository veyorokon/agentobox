"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth"

type UserMenuProps = {
  username?: string | null
  email?: string | null
}

function UserMenu({ username, email }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open, handleClickOutside])

  const handleLogout = useCallback(() => {
    useAuthStore.getState().logout()
    router.push("/login")
  }, [router])

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="h-6 w-6 rounded-full bg-accent flex items-center justify-center text-[10px] text-on-emphasis font-medium uppercase cursor-pointer hover:opacity-90 transition-opacity"
      >
        {username?.charAt(0) ?? "?"}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={cn(
            "absolute bottom-full left-0 mb-2",
            "bg-surface-raised border border-border-default rounded-lg shadow-lg p-2 min-w-[180px]",
            "animate-in fade-in duration-(--duration-normal)",
          )}
        >
          <div className="px-2 py-1.5">
            <div className="text-sm text-secondary font-medium">
              {username ?? "Unknown"}
            </div>
            {email && (
              <div className="text-xs text-muted">{email}</div>
            )}
          </div>

          <div className="my-1 h-px bg-border-default" />

          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-secondary hover:text-default hover:bg-surface-sunken rounded transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export { UserMenu }
export type { UserMenuProps }
