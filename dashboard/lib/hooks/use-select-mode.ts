"use client"

import { useState, useCallback } from "react"

export function useSelectMode<T extends { id: string }>() {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback((items: T[]) => {
    setSelectedIds(prev => {
      if (prev.size === items.length) return new Set()
      return new Set(items.map(i => i.id))
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  return { selectMode, selectedIds, setSelectMode, toggleSelect, toggleAll, clearSelection, exitSelectMode }
}
