import { gql } from "@apollo/client"

export const GET_PROJECT_SECRETS = gql`
  query GetProjectSecrets($projectId: ID!) {
    projectSecrets(projectId: $projectId) {
      id
      key
      createdAt
      updatedAt
    }
  }
`
