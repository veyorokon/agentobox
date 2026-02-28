"use client"

import { useState, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { MODE_CONFIG } from "@/lib/config"
import { useClickOutside } from "@/lib/hooks/use-click-outside"

export interface ModePillProps {
  mode: "auto" | "plan" | "supervised"
  onChange: (mode: "auto" | "plan" | "supervised") => void
}

export function ModePill({ mode, onChange }: ModePillProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cfg = MODE_CONFIG[mode]
  const closeDropdown = useCallback(() => setOpen(false), [])

  useClickOutside(ref, closeDropdown, open)

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        className={cn("text-[10px] font-medium transition-colors hover:opacity-80", cfg.color)}
      >
        {cfg.label}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-28 rounded-md border border-border-default bg-surface-raised shadow-lg z-(--z-dropdown) overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {(Object.keys(MODE_CONFIG) as Array<keyof typeof MODE_CONFIG>).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onChange(key)
                setOpen(false)
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors",
                mode === key
                  ? cn(MODE_CONFIG[key].color, "bg-surface-sunken/40")
                  : "text-secondary hover:bg-surface-sunken/40",
              )}
            >
              {MODE_CONFIG[key].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
