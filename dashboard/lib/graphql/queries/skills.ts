import { gql } from "@apollo/client"

export const GET_SKILLS = gql`
  query GetSkills($projectId: ID!) {
    skills(projectId: $projectId) {
      id
      name
      description
      content
      assignedTags
      assignedToAll
      createdAt
      updatedAt
    }
  }
`
