"use client"

import { Check, X } from "lucide-react"
import { AgentAvatar } from "@/components/agent/avatar"

export interface PlanCardProps {
  agent: string
  title: string
  planStatus: "pending" | "approved" | "rejected" | "superseded"
}

/** Feed notification line for plans (no actions, review happens in pinned card) */
export function PlanCard({
  agent,
  title,
  planStatus,
}: PlanCardProps) {
  if (planStatus === "superseded") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-muted">
          Plan: {title} · superseded
        </span>
      </div>
    )
  }

  if (planStatus === "approved") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-success">
          Plan: {title} <Check className="inline h-3 w-3" strokeWidth={2.5} /> approved
        </span>
      </div>
    )
  }

  if (planStatus === "rejected") {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-muted">
          Plan: {title} <X className="inline h-3 w-3" strokeWidth={2.5} /> rejected
        </span>
      </div>
    )
  }

  // Pending -- just a notification line, no card
  return (
    <div className="flex items-center gap-2 py-0.5 justify-center">
      <AgentAvatar name={agent} size="sm" />
      <span className="text-[10px] font-mono text-warning">
        Plan: {title} · awaiting review
      </span>
    </div>
  )
}
