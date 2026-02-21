"use client"

import { useUIStore } from "@/stores/ui"

export function useToast() {
  const addToast = useUIStore((s) => s.addToast)
  return {
    success: (message: string) => addToast({ message, type: "success" }),
    error: (message: string) => addToast({ message, type: "error" }),
    info: (message: string) => addToast({ message, type: "info" }),
  }
}
