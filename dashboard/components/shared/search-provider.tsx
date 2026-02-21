"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"

interface SearchContextValue {
  open: () => void
  close: () => void
  isOpen: boolean
}

const SearchContext = createContext<SearchContextValue>({
  open: () => {},
  close: () => {},
  isOpen: false,
})

function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  return (
    <SearchContext.Provider value={{ open, close, isOpen }}>
      {children}
    </SearchContext.Provider>
  )
}

function useSearch() {
  return useContext(SearchContext)
}

export { SearchProvider, SearchContext, useSearch }
