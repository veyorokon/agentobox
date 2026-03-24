"use client"

import { useEffect } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useQuery } from "@apollo/client/react"
import { GET_PROJECT } from "@/lib/graphql/queries/projects"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { useThemeStore } from "@/lib/stores/theme"
import { TerminalWorkbenchPrototype, WorkbenchAgent } from "@/components/workbench/terminal-workbench-prototype"
import { normalizeRequestedAgentIds } from "@/components/workbench/workbench-layout"

export default function ProjectWorkbenchPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const syncTheme = useThemeStore((s) => s.syncTheme)
  const { data } = useQuery<{
    project: {
      id: string
      name: string
      themeTokens?: Record<string, string> | null
      themeDocument?: { theme?: string; mode?: string } | null
    } | null
  }>(GET_PROJECT, {
    variables: { id: projectId },
    skip: !projectId,
  })
  const { data: agentsData } = useQuery<{ agents: WorkbenchAgent[] }>(GET_AGENTS, {
    variables: { projectId },
    skip: !projectId,
  })

  useEffect(() => {
    const tokens = data?.project?.themeTokens
    const themeDocument = data?.project?.themeDocument
    if (tokens && Object.keys(tokens).length > 0) {
      syncTheme({
        theme: themeDocument?.theme ?? "custom",
        mode: themeDocument?.mode ?? "dark",
        tokens,
      })
    }
  }, [data?.project?.themeDocument, data?.project?.themeTokens, syncTheme])

  const initialAgentIds = normalizeRequestedAgentIds(searchParams.getAll("agentId"))

  return (
    <TerminalWorkbenchPrototype
      agents={agentsData?.agents ?? []}
      initialAgentIds={initialAgentIds}
      onCloseAgent={(agentId) => {
        const next = new URLSearchParams(searchParams.toString())
        const remaining = normalizeRequestedAgentIds(next.getAll("agentId")).filter(value => value !== agentId)
        next.delete("agentId")
        for (const value of remaining) next.append("agentId", value)
        const query = next.toString()
        router.replace(query ? `/p/${projectId}/workbench?${query}` : `/p/${projectId}/workbench`)
      }}
    />
  )
}
