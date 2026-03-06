import { useLazyQuery } from "@apollo/client/react"
import { useState, useEffect, useRef } from "react"
import { SEARCH_MCP_REGISTRY } from "@/lib/graphql/queries/agents"
import { createLogger } from "@/lib/logger"
import type { McpRegistryServer } from "@/lib/types"

/* ================================================================== */
/*  MCP SEARCH HOOK                                                      */
/*                                                                      */
/*  Encapsulates lazy query + debounce for MCP registry search.         */
/* ================================================================== */

const log = createLogger("apollo")

type McpSearchResult = {
  searchMcpRegistry: {
    servers: McpRegistryServer[]
    nextCursor: string | null
  }
}

export function useMcpSearch() {
  const [query, setQuery] = useState("")
  const [searchMcpRegistry, { data, loading }] = useLazyQuery<McpSearchResult>(SEARCH_MCP_REGISTRY)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const results: McpRegistryServer[] = data?.searchMcpRegistry?.servers ?? []

  // Debounced search
  useEffect(() => {
    if (!query.trim()) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      searchMcpRegistry({ variables: { query, limit: 10 } }).catch(err => {
        log("mutation.error", { mutation: "searchMcpRegistry", error: err.message })
      })
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, searchMcpRegistry])

  return { query, setQuery, results, loading }
}
