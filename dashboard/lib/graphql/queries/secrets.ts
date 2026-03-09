import { gql } from "@apollo/client"

export const GET_ACCOUNT_SECRETS = gql`
  query GetAccountSecrets {
    accountSecrets {
      id
      key
      createdAt
      updatedAt
    }
  }
`

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
