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
      client.cache.modify({
        fields: {
          agents(existing = [], { readField }) {
            const idx = existing.findIndex(
              (ref: any) => readField("id", ref) === updated.id
            )
            if (idx >= 0) {
              const newArr = [...existing]
              newArr[idx] = client.cache.writeFragment({
                fragment: AGENT_FIELDS,
                data: updated,
              })
              return newArr
            }
            return [
              ...existing,
              client.cache.writeFragment({
                fragment: AGENT_FIELDS,
                data: updated,
              }),
            ]
          },
        },
      })
    },
  })

  const agents: Agent[] = data?.agents ?? []

  const activeAgents = useMemo(
    () => agents.filter((a) => a.status !== "stopped" && a.status !== "error"),
    [agents]
  )

  return { agents, activeAgents, loading, error, refetch }
}
