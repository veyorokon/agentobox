import { useQuery } from "@apollo/client/react"

import { GET_PROJECT_GDA_OVERVIEW } from "@/lib/graphql/queries/gda"


export type GdaOverviewGoalProgress = {
  goalId: string
  goalName: string
  status: string
  missingDimensions: string[]
  failedDimensions: string[]
}

export type GdaOverview = {
  contextVersionId: string
  subjectRef: string
  subjectName: string
  worldRef: string
  objective: {
    objectiveId: string
    name: string
    description: string
  } | null
  awareness: {
    controlStatus: string
    stateEntryCount: number
    activeCommitmentCount: number
    recentObservationCount: number
    lastObservedAt: string | null
  }
  progress: {
    objectiveId: string
    status: string
    totalGoals: number
    satisfiedGoals: number
    unknownGoals: number
    failedGoals: number
    goalProgress: GdaOverviewGoalProgress[]
  }
  activeCommitments: Array<{
    commitmentId: string
    capabilityId: string
    status: string
    objectiveId: string
    assignmentAgentRef: string | null
    assignmentAgentName: string | null
  }>
  recentObservations: Array<{
    observationId: string
    kind: string
    subject: string
    observedAt: string | null
    sourceKind: string
    sourceId: string
    quality: string
  }>
  recentExecutions: Array<{
    invocationId: string
    status: string
    commitmentId: string | null
    createdAt: string | null
    completedAt: string | null
  }>
  stateEntries: Array<{
    dimensionId: string
    value: unknown
    schemaRef: string
    origin: string
    validFrom: string | null
    validUntil: string | null
  }>
}

type GdaOverviewData = {
  project: {
    id: string
    name: string
    gdaOverview: GdaOverview | null
  } | null
}


export function useProjectGdaOverview(projectId: string | undefined) {
  return useQuery<GdaOverviewData>(GET_PROJECT_GDA_OVERVIEW, {
    variables: { id: projectId },
    skip: !projectId,
    pollInterval: 3000,
    returnPartialData: true,
    notifyOnNetworkStatusChange: false,
  })
}
