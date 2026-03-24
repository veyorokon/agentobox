"use client"

import { useEffect } from "react"
import { useParams } from "next/navigation"
import { useQuery } from "@apollo/client/react"
import { GET_PROJECT } from "@/lib/graphql/queries/projects"
import { useThemeStore } from "@/lib/stores/theme"
import { TerminalWorkbenchPrototype } from "@/components/workbench/terminal-workbench-prototype"

export default function ProjectWorkbenchPage() {
  const { projectId } = useParams<{ projectId: string }>()
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

  return <TerminalWorkbenchPrototype projectName={data?.project?.name ?? "Workbench Prototype"} />
}
