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
  mutation CreateTask($agentId: ID!, $subject: String!) {
    createTask(agentId: $agentId, subject: $subject) {
      taskId
      subject
      description
      status
      owner
      activeForm
      blockedBy
      createdAt
      updatedAt
    }
  }
`
