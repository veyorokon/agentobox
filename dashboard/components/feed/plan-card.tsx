"use client"

import { Check, X } from "lucide-react"
import { CompactStatusLine } from "@/components/feed/compact-status-line"

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
      <CompactStatusLine agent={agent}>
        Plan: {title} · superseded
      </CompactStatusLine>
    )
  }

  if (planStatus === "approved") {
    return (
      <CompactStatusLine agent={agent} color="text-success">
        Plan: {title} <Check className="inline h-3 w-3" strokeWidth={2.5} /> approved
      </CompactStatusLine>
    )
  }

  if (planStatus === "rejected") {
    return (
      <CompactStatusLine agent={agent}>
        Plan: {title} <X className="inline h-3 w-3" strokeWidth={2.5} /> rejected
      </CompactStatusLine>
    )
  }

  // Pending -- just a notification line, no card
  return (
    <CompactStatusLine agent={agent} color="text-warning">
      Plan: {title} · awaiting review
    </CompactStatusLine>
  )
}
