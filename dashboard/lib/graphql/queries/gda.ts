import { gql } from "@apollo/client"

export const GET_PROJECT_GDA_OVERVIEW = gql`
  query GetProjectGdaOverview($id: ID!) {
    project(id: $id) {
      id
      name
      gdaOverview {
        contextVersionId
        subjectRef
        subjectName
        worldRef
        objective {
          objectiveId
          name
          description
        }
        awareness {
          controlStatus
          stateEntryCount
          activeCommitmentCount
          recentObservationCount
          lastObservedAt
        }
        progress {
          objectiveId
          status
          totalGoals
          satisfiedGoals
          unknownGoals
          failedGoals
          goalProgress {
            goalId
            goalName
            status
            missingDimensions
            failedDimensions
          }
        }
        activeCommitments {
          commitmentId
          capabilityId
          status
          objectiveId
          assignmentAgentRef
          assignmentAgentName
        }
        recentObservations {
          observationId
          kind
          subject
          observedAt
          sourceKind
          sourceId
          quality
        }
        recentExecutions {
          invocationId
          status
          commitmentId
          createdAt
          completedAt
        }
        stateEntries {
          dimensionId
          value
          schemaRef
          origin
          validFrom
          validUntil
        }
      }
    }
  }
`
