"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@apollo/client"
import { useAuthStore } from "@/stores/auth"
import { PROJECTS_QUERY } from "@/lib/graphql/queries"
import type { Project } from "@/types"

export default function Home() {
  const router = useRouter()
  const token = useAuthStore((s) => s.token)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const { data } = useQuery(PROJECTS_QUERY, {
    skip: !mounted || !token,
  })

  const projects: Project[] = data?.projects ?? []

  useEffect(() => {
    if (!mounted) return
    if (!token) {
      router.replace("/login")
      return
    }
    if (projects.length > 0) {
      router.replace(`/${projects[0].id}`)
    }
  }, [token, mounted, projects, router])

  if (!mounted || !token) return null

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-100">
      <p className="text-text-400 text-sm">
        {projects.length === 0 ? "No projects yet" : "Loading..."}
      </p>
    </div>
  )
}
