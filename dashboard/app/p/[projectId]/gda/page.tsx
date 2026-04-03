"use client"

import { useParams } from "next/navigation"

import { GdaLiveBoard } from "@/components/gda/live-board"


export default function ProjectGdaPage() {
  const { projectId } = useParams<{ projectId: string }>()
  return <GdaLiveBoard projectId={projectId} />
}
