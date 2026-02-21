"use client"

import { forwardRef, useEffect, useRef, type TextareaHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, onChange, ...props }, ref) => {
    const internalRef = useRef<HTMLTextAreaElement | null>(null)

    const setRefs = (node: HTMLTextAreaElement | null) => {
      internalRef.current = node
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    }

    const resize = () => {
      const el = internalRef.current
      if (!el) return
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    }

    useEffect(() => {
      resize()
    })

    return (
      <textarea
        ref={setRefs}
        className={cn(
          "w-full rounded-lg border border-border-300 bg-bg-000/60 px-3 py-2 text-sm text-text-100 placeholder:text-text-500 focus:outline-none focus:ring-1 focus:ring-accent-main-100/50 focus:bg-bg-000 transition-colors resize-none min-h-[40px] max-h-[40vh]",
          className,
        )}
        onChange={(e) => {
          resize()
          onChange?.(e)
        }}
        {...props}
      />
    )
  },
)

Textarea.displayName = "Textarea"

export { Textarea }
export type { TextareaProps }
