import { useQuery } from "@apollo/client"
import { useMemo } from "react"
import { GET_AVAILABLE_MODELS, GET_PROVIDER_STATUS } from "@/lib/graphql/queries/models"

/* ================================================================== */
/*  MODEL + PROVIDER HOOKS                                              */
/*                                                                      */
/*  availableModels is static registry data — no variables needed.     */
/*  providerStatus is project-scoped (checks which keys are set).      */
/* ================================================================== */

type ModelEntry = {
  value: string
  label: string
  provider: string
}

type ProviderStatus = {
  slug: string
  name: string
  keyName: string
  configured: boolean
}

type ModelsData = { availableModels: ModelEntry[] }
type ProviderStatusData = { providerStatus: ProviderStatus[] }

/** Static model registry — cached aggressively, no polling needed. */
export function useAvailableModels() {
  const { data, loading, error } = useQuery<ModelsData>(GET_AVAILABLE_MODELS, {
    fetchPolicy: "cache-first",
  })

  return { models: data?.availableModels ?? [], loading, error }
}

/** Provider key configuration status for a project. */
export function useProviderStatus(projectId: string) {
  const queryVars = useMemo(() => ({ projectId }), [projectId])

  const { data, loading, error } = useQuery<ProviderStatusData>(GET_PROVIDER_STATUS, {
    variables: queryVars,
    skip: !projectId,
    fetchPolicy: "cache-and-network",
  })

  return { providers: data?.providerStatus ?? [], loading, error }
}
