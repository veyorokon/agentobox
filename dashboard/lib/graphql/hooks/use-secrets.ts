import { useQuery, useMutation } from "@apollo/client"
import { useCallback, useMemo } from "react"
import { useParams } from "next/navigation"
import { GET_PROJECT_SECRETS } from "@/lib/graphql/queries/secrets"
import { SET_SECRET, DELETE_SECRET } from "@/lib/graphql/mutations/secrets"
import { createLogger } from "@/lib/logger"

/* ================================================================== */
/*  SECRET HOOKS                                                         */
/*                                                                      */
/*  Follows the refetch pattern: mutations refetch the full query list  */
/*  rather than manual cache.modify.                                    */
/* ================================================================== */

const log = createLogger("apollo")

type SecretEntry = {
  id: string
  key: string
  createdAt: string
  updatedAt: string
}

type SecretsData = { projectSecrets: SecretEntry[] }

/** Query project secrets. Skips when modal is not open or projectId missing. */
export function useSecrets(projectId: string, skip?: boolean) {
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  return useQuery<SecretsData>(GET_PROJECT_SECRETS, {
    variables: queryVars,
    skip: skip || !projectId,
    fetchPolicy: "cache-and-network",
  })
}

/** Set (create/update) a secret. Refetches secret list on completion. */
export function useSetSecret(projectId: string) {
  const [mutate] = useMutation(SET_SECRET, {
    refetchQueries: [{ query: GET_PROJECT_SECRETS, variables: { projectId } }],
  })

  return useCallback(
    (key: string, value: string) => {
      if (!projectId) return
      log("mutation.setSecret", { key, projectId })
      return mutate({
        variables: { input: { projectId, key, value } },
      }).catch(err => {
        log("mutation.error", { mutation: "setSecret", error: err.message })
      })
    },
    [mutate, projectId],
  )
}

/** Delete a secret by key. Refetches secret list on completion. */
export function useDeleteSecret(projectId: string) {
  const [mutate] = useMutation(DELETE_SECRET, {
    refetchQueries: [{ query: GET_PROJECT_SECRETS, variables: { projectId } }],
  })

  return useCallback(
    (key: string) => {
      if (!projectId) return
      log("mutation.deleteSecret", { key, projectId })
      return mutate({
        variables: { projectId, key },
      }).catch(err => {
        log("mutation.error", { mutation: "deleteSecret", error: err.message })
      })
    },
    [mutate, projectId],
  )
}
