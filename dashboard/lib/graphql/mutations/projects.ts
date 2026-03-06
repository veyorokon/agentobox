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

export const SET_PROJECT_THEME = gql`
  mutation SetProjectTheme($input: SetProjectThemeInput!) {
    setProjectTheme(input: $input)
  }
`
