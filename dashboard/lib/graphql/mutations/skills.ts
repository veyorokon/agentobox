import { gql } from "@apollo/client"

export const CREATE_SKILL = gql`
  mutation CreateSkill($input: CreateSkillInput!) {
    createSkill(input: $input) {
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

export const UPDATE_SKILL = gql`
  mutation UpdateSkill($input: UpdateSkillInput!) {
    updateSkill(input: $input) {
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

export const DELETE_SKILL = gql`
  mutation DeleteSkill($skillId: ID!) {
    deleteSkill(skillId: $skillId)
  }
`
