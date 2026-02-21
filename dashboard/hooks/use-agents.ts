"use client"

import { useQuery, useSubscription } from "@apollo/client"
import { useMemo } from "react"
import { AGENTS_QUERY } from "@/lib/graphql/queries"
import { AGENT_UPDATED_SUBSCRIPTION } from "@/lib/graphql/subscriptions"
import { AGENT_FIELDS } from "@/lib/graphql/fragments"
import type { Agent } from "@/types"

export function useAgents(projectId: string | null) {
  const { data, loading, error, refetch } = useQuery(AGENTS_QUERY, {
    variables: { projectId: projectId! },
    skip: !projectId,
  })

  useSubscription(AGENT_UPDATED_SUBSCRIPTION, {
    variables: { projectId: projectId! },
    skip: !projectId,
    onData: ({ client, data: subData }) => {
      const updated = subData.data?.agentUpdated
      if (!updated) return

      // Write the fragment so the cache has the latest data for this agent
      client.cache.writeFragment({
        fragment: AGENT_FIELDS,
        data: updated,
      })

      // Update the query scoped to this specific projectId
      client.cache.updateQuery(
        { query: AGENTS_QUERY, variables: { projectId: projectId! } },
        (existing) => {
          if (!existing?.agents) return existing
          const updatedRef = client.cache.identify(updated)
          const exists = existing.agents.some(
            (a: any) => client.cache.identify(a) === updatedRef
          )
          if (exists) {
            // Agent already in list — fragment write above handles field updates
            return existing
          }
          // New agent — append to the list
          return { ...existing, agents: [...existing.agents, updated] }
        }
      )
    },
  })

  const agents: Agent[] = data?.agents ?? []

  const activeAgents = useMemo(
    () => agents.filter((a) => a.status !== "stopped" && a.status !== "error"),
    [agents]
  )

  return { agents, activeAgents, loading, error, refetch }
}
