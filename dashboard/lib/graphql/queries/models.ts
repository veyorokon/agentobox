import { gql } from "@apollo/client"

export const GET_AVAILABLE_MODELS = gql`
  query AvailableModels {
    availableModels {
      value
      label
      provider
    }
  }
`

export const GET_PROVIDER_STATUS = gql`
  query ProviderStatus($projectId: ID!) {
    providerStatus(projectId: $projectId) {
      slug
      name
      keyName
      configured
    }
  }
`
