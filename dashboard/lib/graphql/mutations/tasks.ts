import { gql } from "@apollo/client"

export const UPDATE_TASK = gql`
  mutation UpdateTask($agentId: ID!, $taskId: String!, $status: String!) {
    updateTask(agentId: $agentId, taskId: $taskId, status: $status) {
      taskId
      status
      updatedAt
    }
  }
`

export const CREATE_TASK = gql`
  mutation CreateTask($agentId: ID!, $title: String!, $description: String!) {
    createTask(agentId: $agentId, title: $title, description: $description) {
      taskId
      title
      description
      status
      assignee
      activeForm
      blockedBy
      createdAt
      updatedAt
    }
  }
`
