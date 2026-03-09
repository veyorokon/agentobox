import { useQuery, useMutation } from "@apollo/client/react"
import { useCallback, useMemo } from "react"
import { GET_ACCOUNT_SECRETS, GET_PROJECT_SECRETS } from "@/lib/graphql/queries/secrets"
import { SET_ACCOUNT_SECRET, DELETE_ACCOUNT_SECRET, SET_SECRET, DELETE_SECRET } from "@/lib/graphql/mutations/secrets"
import { createLogger } from "@/lib/logger"

/* ================================================================== */
/*  SECRET HOOKS                                                         */
/*                                                                      */
/*  Two levels: account (user-wide) and project (project-scoped).      */
/*  Mutations refetch the relevant query list on completion.            */
/* ================================================================== */

const log = createLogger("apollo")

export type SecretEntry = {
  id: string
  key: string
  createdAt: string
  updatedAt: string
}

type AccountSecretsData = { accountSecrets: SecretEntry[] }
type ProjectSecretsData = { projectSecrets: SecretEntry[] }

// ── Account-level secrets ──

/** Query account-level secrets for the authenticated user. */
export function useAccountSecrets(skip?: boolean) {
  return useQuery<AccountSecretsData>(GET_ACCOUNT_SECRETS, {
    skip,
    fetchPolicy: "cache-and-network",
  })
}

/** Set (create/update) an account-level secret. */
export function useSetAccountSecret() {
  const [mutate] = useMutation(SET_ACCOUNT_SECRET, {
    refetchQueries: [{ query: GET_ACCOUNT_SECRETS }],
  })

  return useCallback(
    (key: string, value: string) => {
      log("mutation.setAccountSecret", { key })
      return mutate({
        variables: { input: { key, value } },
      }).catch(err => {
        log("mutation.error", { mutation: "setAccountSecret", error: err.message })
      })
    },
    [mutate],
  )
}

/** Delete an account-level secret by key. */
export function useDeleteAccountSecret() {
  const [mutate] = useMutation(DELETE_ACCOUNT_SECRET, {
    refetchQueries: [{ query: GET_ACCOUNT_SECRETS }],
  })

  return useCallback(
    (key: string) => {
      log("mutation.deleteAccountSecret", { key })
      return mutate({
        variables: { key },
      }).catch(err => {
        log("mutation.error", { mutation: "deleteAccountSecret", error: err.message })
      })
    },
    [mutate],
  )
}

// ── Project-level secrets ──

/** Query project secrets. Skips when modal is not open or projectId missing. */
export function useSecrets(projectId: string, skip?: boolean) {
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  return useQuery<ProjectSecretsData>(GET_PROJECT_SECRETS, {
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
