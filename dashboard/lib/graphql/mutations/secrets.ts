import { gql } from "@apollo/client"

export const SET_SECRET = gql`
  mutation SetSecret($input: SetSecretInput!) {
    setSecret(input: $input) {
      id
      key
      createdAt
      updatedAt
    }
  }
`

export const DELETE_SECRET = gql`
  mutation DeleteSecret($projectId: ID!, $key: String!) {
    deleteSecret(projectId: $projectId, key: $key)
  }
`
