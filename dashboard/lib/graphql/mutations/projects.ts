import { gql } from "@apollo/client"

export const CREATE_PROJECT = gql`
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      id
      name
      description
      createdAt
    }
  }
`
