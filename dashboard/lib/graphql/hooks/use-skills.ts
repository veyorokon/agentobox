import { useQuery, useMutation } from "@apollo/client"
import { useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import { GET_SKILLS } from "@/lib/graphql/queries/skills"
import { CREATE_SKILL, UPDATE_SKILL, DELETE_SKILL } from "@/lib/graphql/mutations/skills"
import { createLogger } from "@/lib/logger"
import type { Skill } from "@/lib/types"

/* ================================================================== */
/*  SKILL HOOKS                                                         */
/*                                                                      */
/*  Follows the refetch pattern (like secrets): mutations refetch the   */
/*  full query list rather than manual cache.modify.                    */
/* ================================================================== */

const log = createLogger("apollo")

type SkillsData = { skills: Skill[] }

/** Query all skills for the current project. */
export function useSkills() {
  const { projectId } = useParams<{ projectId: string }>()
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  return useQuery<SkillsData>(GET_SKILLS, {
    fetchPolicy: "cache-and-network",
    variables: queryVars,
    skip: !projectId,
  })
}

/** Create a skill. Refetches skill list on completion. */
export function useCreateSkill() {
  const { projectId } = useParams<{ projectId: string }>()
  const [mutate] = useMutation(CREATE_SKILL, {
    refetchQueries: [{ query: GET_SKILLS, variables: { projectId } }],
  })

  return useCallback(
    (name: string, content: string, description: string = "", assignedTags: string[] = [], assignedToAll: boolean = false) => {
      if (!projectId) return
      log("mutation.createSkill", { name, projectId })
      mutate({
        variables: {
          input: { projectId, name, content, description, assignedTags, assignedToAll },
        },
      })
    },
    [mutate, projectId],
  )
}

/** Update an existing skill. Refetches skill list on completion. */
export function useUpdateSkill() {
  const { projectId } = useParams<{ projectId: string }>()
  const [mutate] = useMutation(UPDATE_SKILL, {
    refetchQueries: [{ query: GET_SKILLS, variables: { projectId } }],
  })

  return useCallback(
    (skillId: string, updates: { name?: string; description?: string; content?: string; assignedTags?: string[]; assignedToAll?: boolean }) => {
      log("mutation.updateSkill", { skillId, ...updates })
      mutate({
        variables: {
          input: { skillId, ...updates },
        },
      })
    },
    [mutate, projectId],
  )
}

/** Delete a skill. Refetches skill list on completion. */
export function useDeleteSkill() {
  const { projectId } = useParams<{ projectId: string }>()
  const [mutate] = useMutation(DELETE_SKILL, {
    refetchQueries: [{ query: GET_SKILLS, variables: { projectId } }],
  })

  return useCallback(
    (skillId: string) => {
      log("mutation.deleteSkill", { skillId })
      mutate({ variables: { skillId } })
    },
    [mutate, projectId],
  )
}
