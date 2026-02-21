"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation } from "@apollo/client"
import { useAuthStore } from "@/stores/auth"
import { useUIStore } from "@/stores/ui"
import { PROJECTS_QUERY } from "@/lib/graphql/queries"
import { CREATE_PROJECT_MUTATION } from "@/lib/graphql/mutations"
import { Sidebar } from "@/components/layout/sidebar"
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
  const selectProject = useUIStore((s) => s.selectProject)

  // Auth guard
  useEffect(() => {
    if (!token) {
      router.push("/login")
    }
  }, [token, router])

  const { data: projectsData } = useQuery(PROJECTS_QUERY, {
    skip: !token,
  })

  const [createProject] = useMutation(CREATE_PROJECT_MUTATION, {
    refetchQueries: [{ query: PROJECTS_QUERY }],
  })

  const projects: Project[] = projectsData?.projects ?? []

  // Auto-select first project if none selected
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      selectProject(projects[0].id)
    }
  }, [selectedProjectId, projects, selectProject])

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

  if (!token) return null

  return (
    <div className="h-screen flex overflow-hidden bg-bg-100">
      {sidebarOpen && (
        <Sidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          onNewProject={handleNewProject}
          username={user?.username}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>
    </div>
  )
}
