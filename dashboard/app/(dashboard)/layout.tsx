"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "@apollo/client"
import { useAuthStore } from "@/stores/auth"
import { useUIStore } from "@/stores/ui"
import { PROJECTS_QUERY } from "@/lib/graphql/queries"
import { CREATE_PROJECT_MUTATION } from "@/lib/graphql/mutations"
import { AgentRoster } from "@/components/layout/agent-roster"
import { SearchProvider } from "@/components/shared/search-provider"
import { SearchOverlay } from "@/components/shared/search-overlay"
import { useAgents } from "@/hooks/use-agents"
import type { Project } from "@/types"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const selectedProjectId = useUIStore((s) => s.selectedProjectId)
  const selectedAgentId = useUIStore((s) => s.selectedAgentId)
  const selectProject = useUIStore((s) => s.selectProject)
  const selectAgent = useUIStore((s) => s.selectAgent)

  // Hydration guard: Zustand persist middleware hasn't rehydrated from
  // localStorage on the first SSR render, so token reads as null.
  // Without this, every page load flash-redirects to /login.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Auth guard — only runs after hydration
  useEffect(() => {
    if (mounted && !token) {
      router.push("/login")
    }
  }, [mounted, token, router])

  const { data: projectsData } = useQuery(PROJECTS_QUERY, {
    skip: !mounted || !token,
  })

  const [createProject] = useMutation(CREATE_PROJECT_MUTATION, {
    refetchQueries: [{ query: PROJECTS_QUERY }],
  })

  const projects: Project[] = projectsData?.projects ?? []

  // Agents for the roster sidebar and search overlay
  const { agents } = useAgents(selectedProjectId)

  // Find the current project name for the roster
  const currentProject = projects.find((p) => p.id === selectedProjectId)

  // Auto-select first project if none selected
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      selectProject(projects[0].id)
      router.push(`/${projects[0].id}`)
    }
  }, [selectedProjectId, projects, selectProject, router])

  const handleSelectProject = (id: string) => {
    selectProject(id)
    router.push(`/${id}`)
  }

  const handleNewProject = async (name: string) => {
    const { data } = await createProject({
      variables: { input: { name } },
    })
    if (data?.createProject?.id) {
      selectProject(data.createProject.id)
      router.push(`/${data.createProject.id}`)
    }
  }

  const addToast = useUIStore((s) => s.addToast)

  const handleAddAgent = useCallback(() => {
    // TODO: Wire to deploy sheet / creation modal
    addToast({ message: "Agent creation coming soon", type: "info" })
  }, [addToast])

  if (!mounted || !token) return null

  return (
    <SearchProvider>
      <div className="h-screen flex overflow-hidden bg-surface">
        {sidebarOpen && (
          <AgentRoster
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={selectAgent}
            onAddAgent={handleAddAgent}
            projectName={currentProject?.name}
            username={user?.username}
            email={user?.email}
          />
        )}
        <div className="flex-1 flex flex-col min-w-0">
          {children}
        </div>
        <SearchOverlay projects={projects} agents={agents} />
      </div>
    </SearchProvider>
  )
}
