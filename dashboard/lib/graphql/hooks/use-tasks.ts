import { useQuery, useMutation } from "@apollo/client"
import { useCallback, useEffect, useRef } from "react"
import { GET_AGENT_TASKS } from "@/lib/graphql/queries/tasks"
import { UPDATE_TASK, CREATE_TASK } from "@/lib/graphql/mutations/tasks"
import { createLogger } from "@/lib/logger"
import type { AgentTask } from "@/lib/types"

/* ================================================================== */
/*  TASK HOOKS                                                          */
/*                                                                      */
/*  Follows the refetch pattern (like secrets/skills): mutations        */
/*  refetch the full query list rather than manual cache.modify.        */
/* ================================================================== */

const log = createLogger("apollo")

type AgentTasksData = { agent: { id: string; tasks: AgentTask[] } | null }

/** Fetch tasks for a single agent. Refetches when todoProgress changes. */
export function useAgentTasks(agentId: string, todoProgress?: { done: number; total: number } | null) {
  const { data, loading, refetch } = useQuery<AgentTasksData>(GET_AGENT_TASKS, {
    variables: { agentId },
    fetchPolicy: "cache-and-network",
  })

  // Refetch when todoProgress changes (driven by subscription)
  const prevProgress = useRef(todoProgress)
  useEffect(() => {
    const prev = prevProgress.current
    prevProgress.current = todoProgress
    if (!prev || !todoProgress) return
    if (prev.done !== todoProgress.done || prev.total !== todoProgress.total) {
      refetch()
    }
  }, [todoProgress, refetch])

  return { tasks: data?.agent?.tasks ?? [], loading }
}

/** Toggle task status between pending ↔ completed. */
export function useUpdateTask() {
  const [mutate] = useMutation(UPDATE_TASK)

  return useCallback(
    (agentId: string, taskId: string, status: string) => {
      log("mutation.updateTask", { agentId, taskId, status })
      mutate({
        variables: { agentId, taskId, status },
        refetchQueries: [{ query: GET_AGENT_TASKS, variables: { agentId } }],
      }).catch((err) => {
        log("mutation.error", { mutation: "updateTask", agentId, error: err.message })
      })
    },
    [mutate],
  )
}

/** Create a new task from the dashboard. */
export function useCreateTask() {
  const [mutate] = useMutation(CREATE_TASK)

  return useCallback(
    (agentId: string, subject: string) => {
      log("mutation.createTask", { agentId, subject })
      return mutate({
        variables: { agentId, subject },
        refetchQueries: [{ query: GET_AGENT_TASKS, variables: { agentId } }],
      }).catch((err) => {
        log("mutation.error", { mutation: "createTask", agentId, error: err.message })
      })
    },
    [mutate],
  )
}
